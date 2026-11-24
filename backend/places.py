"""Per-trip place catalogue and independently scheduled visits.

A place's permanent ID is its original stop record. This keeps all pre-v5 foreign keys and
deep links valid. Further visits have their own record IDs and point back to that place.
"""

import datetime as dt
import json
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, HTTPException, Response
from pydantic import Field, field_validator, model_validator

from . import models, store


router = APIRouter(prefix="/api/trips/{tid}")
OSMType = Literal["node", "way", "relation"]
Kind = Literal["stop", "sight", "sleep"]
Id = Annotated[int, Field(gt=0)]
SCHEDULE = ("stage_id", "variant_id", "date", "time", "end_date", "done", "position", "kind")
SHARED = ("title", "tags", "address", "lat", "lon", "notes")
OLD_CATEGORY = {"stop": "Ort", "sleep": "Schlafplatz", "sight": "Sehenswürdigkeit"}
OLD_ICON = {"stop": "map-pin", "sleep": "bed-double", "sight": "camera"}


class PlaceLink(models.Form):
    label: models.Name
    url: Annotated[str, Field(max_length=4096)]

    @field_validator("url")
    @classmethod
    def web_link(cls, value):
        value = value.strip()
        url = urlsplit(value)
        if url.scheme not in ("http", "https") or not url.hostname or any(ord(c) < 32 for c in value):
            raise ValueError("Bitte einen vollständigen HTTP- oder HTTPS-Link eingeben.")
        return value


class Place(models.TaggedForm):
    title: models.Name
    category: models.Name = "Ort"
    address: models.Short = ""
    lat: Annotated[float, Field(ge=-90, le=90)] | None = None
    lon: Annotated[float, Field(ge=-180, le=180)] | None = None
    description: models.Note = ""
    links: list[PlaceLink] = Field(default_factory=list)
    icon_type: Literal["emoji", "lucide"] = "lucide"
    icon: models.Name = "map-pin"
    osm_type: OSMType | None = None
    osm_id: Id | None = None

    @model_validator(mode="after")
    def pairs(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Breiten- und Längengrad bitte zusammen angeben.")
        if (self.osm_type is None) != (self.osm_id is None):
            raise ValueError("OSM-Typ und OSM-ID gehören zusammen.")
        return self


class VisitCreate(models.Form):
    place_id: Id | None = None
    place: Place | None = None
    stage_id: Id | None = None
    variant_id: Id | None = None
    date: dt.date | None = None
    time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    end_date: dt.date | None = None
    done: bool = False
    position: Annotated[int, Field(ge=0)] | None = None
    kind: Kind | None = None

    @model_validator(mode="after")
    def one_place(self):
        if (self.place is None) == (self.place_id is None):
            raise ValueError("Einen vorhandenen oder einen neuen Ort angeben.")
        return self


def migrate(con):
    con.execute("""CREATE TABLE IF NOT EXISTS places (
        id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        category TEXT NOT NULL, icon_type TEXT NOT NULL, icon TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]',
        osm_type TEXT, osm_id INTEGER, anchor_used INTEGER NOT NULL DEFAULT 0,
        UNIQUE(trip_id,osm_type,osm_id))""")
    con.execute("CREATE INDEX IF NOT EXISTS places_by_trip ON places(trip_id,id)")
    con.execute("""CREATE INDEX IF NOT EXISTS stops_by_place ON records(trip_id,json_extract(data,'$.place_id'))
                   WHERE collection='stops'""")
    con.execute("""CREATE TABLE IF NOT EXISTS place_images (
        place_id INTEGER PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE, filename TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL,
        revision TEXT NOT NULL DEFAULT (lower(hex(randomblob(8)))))""")
    for row in con.execute("""SELECT r.* FROM records r LEFT JOIN places p ON r.id=p.id
        WHERE r.collection='stops' AND p.id IS NULL AND json_extract(r.data,'$.place_id') IS NULL"""):
        register(con, store.unpack(row))


def register(con, stop):
    kind = stop["kind"]
    con.execute("""INSERT INTO places(id,trip_id,category,icon_type,icon,anchor_used)
        VALUES(?,?,?,'lucide',?,?)""", (stop["id"], stop["trip_id"], OLD_CATEGORY[kind], OLD_ICON[kind], not stop["saved"]))


def category_kind(category):
    if category.casefold() in ("schlafplatz", "camping", "campingplatz", "unterkunft"):
        return "sleep"
    return "stop" if category.casefold() in ("ort", "sonstiges", "zwischenstopp") else "sight"


PLACE_SELECT = """SELECT p.*,r.data,i.filename,i.mime_type,i.size,i.revision FROM places p
    JOIN records r ON r.id=p.id LEFT JOIN place_images i ON i.place_id=p.id WHERE p.trip_id=?"""


def describe(row):
    stop = json.loads(row["data"])
    image = None
    if row["filename"] is not None:
        image = {k: row[k] for k in ("filename", "mime_type", "size")}
        image["url"] = f"/api/trips/{row['trip_id']}/places/{row['id']}/image?v={row['revision']}"
    return {**{k: row[k] for k in ("id", "trip_id", "category", "icon_type", "icon", "osm_type", "osm_id")},
            **{k: stop[k] for k in SHARED if k != "notes"}, "description": stop["notes"],
            "links": json.loads(row["links"]), "image": image}


def place_rows(con, tid):
    return [describe(r) for r in con.execute(PLACE_SELECT + " ORDER BY p.id", (tid,))]


def place_row(con, tid, pid):
    row = con.execute(PLACE_SELECT + " AND p.id=?", (tid, pid)).fetchone()
    if row is None:
        raise HTTPException(404, "Ort in dieser Reise nicht gefunden.")
    return describe(row)


def linked_stops(con, tid, pid):
    return [store.unpack(row) for row in con.execute("""SELECT * FROM records WHERE trip_id=? AND collection='stops'
        AND (id=? OR json_extract(data,'$.place_id')=?) ORDER BY id""", (tid, pid, pid))]


def share_fields(con, tid, pid, updates, skip=None):
    for stop in linked_stops(con, tid, pid):
        if stop["id"] != skip and any(stop[k] != v for k, v in updates.items()):
            store.put(con, tid, "stops", {**stop, **updates})


def track_stop_write(con, saved, original, fields, visit_only):
    tid, sid, pid = saved["trip_id"], saved["id"], saved["place_id"]
    if not original and pid == sid:
        register(con, saved)
    if sid == pid and not saved["saved"]:
        con.execute("UPDATE places SET anchor_used=1 WHERE id=? AND anchor_used=0", (pid,))
    if original and not visit_only:
        updates = {k: saved[k] for k in SHARED if k in fields and saved[k] != original[k]}
        if updates:
            share_fields(con, tid, pid, updates, skip=sid)
        if "kind" in fields and original["kind"] != saved["kind"] and original["saved"]:
            con.execute("UPDATE places SET category=? WHERE id=?", (OLD_CATEGORY[saved["kind"]], pid))


def save_place(con, tid, fields, pid=None):
    store.trip(con, tid)
    previous = place_row(con, tid, pid) if pid is not None else None
    value = store.validated(Place, fields, previous)
    if value["osm_id"] is not None:
        existing = con.execute("SELECT id FROM places WHERE trip_id=? AND osm_type=? AND osm_id=?",
                               (tid, value["osm_type"], value["osm_id"])).fetchone()
        if existing and pid != existing["id"]:
            if pid is not None:
                raise HTTPException(409, "Dieses OpenStreetMap-Objekt ist bereits in der Reise gespeichert.")
            return place_row(con, tid, existing["id"]), False
    shared = {k: value[k] for k in SHARED if k != "notes"}
    shared["notes"] = value["description"]
    if pid is None:
        pid = store.upsert(con, tid, "stops", {**shared, "saved": True, "kind": category_kind(value["category"])})["id"]
    else:
        share_fields(con, tid, pid, shared)
        if previous["category"] != value["category"]:
            anchor = store.record(con, tid, "stops", pid)
            if anchor["saved"]:
                store.put(con, tid, "stops", {**anchor, "kind": category_kind(value["category"])})
    con.execute("""UPDATE places SET category=?,icon_type=?,icon=?,links=?,osm_type=?,osm_id=? WHERE id=?""",
                (value["category"], value["icon_type"], value["icon"], json.dumps(value["links"], ensure_ascii=False),
                 value["osm_type"], value["osm_id"], pid))
    return place_row(con, tid, pid), True


@router.get("/places")
def list_places(tid: int):
    with store.session() as con:
        store.trip(con, tid)
        return place_rows(con, tid)


@router.post("/places", status_code=201)
def create_place(tid: int, body: Place):
    with store.session(True) as con:
        return save_place(con, tid, body.model_dump())[0]


@router.get("/places/{pid}")
def get_place(tid: int, pid: int):
    with store.session() as con:
        return place_row(con, tid, pid)


@router.patch("/places/{pid}")
def edit_place(tid: int, pid: int, body: dict = Body(...)):
    with store.session(True) as con:
        return save_place(con, tid, body, pid)[0]


@router.delete("/places/{pid}", status_code=204)
def delete_place(tid: int, pid: int):
    with store.session(True) as con:
        place_row(con, tid, pid)
        if any(not s["saved"] for s in linked_stops(con, tid, pid)):
            raise HTTPException(409, "Entferne zuerst die Besuche dieses Ortes aus deiner Route.")
        store.remove(con, tid, "stops", pid)
    return Response(status_code=204)


def visit(stop):
    return {k: stop[k] for k in ("id", "trip_id", "place_id", *SCHEDULE)}


def visit_row(con, tid, vid):
    stop = store.record(con, tid, "stops", vid)
    if stop["saved"]:
        raise HTTPException(404, "Besuch in dieser Reise nicht gefunden.")
    return stop


@router.get("/visits")
def list_visits(tid: int):
    with store.session() as con:
        store.trip(con, tid)
        return [visit(s) for s in store.records(con, tid, "stops") if not s["saved"]]


@router.get("/visits/{vid}")
def get_visit(tid: int, vid: int):
    with store.session() as con:
        return visit(visit_row(con, tid, vid))


@router.post("/visits", status_code=201)
def create_visit(tid: int, body: VisitCreate):
    with store.session(True) as con:
        place = save_place(con, tid, body.place.model_dump())[0] if body.place else place_row(con, tid, body.place_id)
        pid = place["id"]
        anchor = store.record(con, tid, "stops", pid)
        used = con.execute("SELECT anchor_used FROM places WHERE id=?", (pid,)).fetchone()[0]
        fields = {k: anchor[k] for k in SHARED}
        fields.update(body.model_dump(mode="json", exclude={"place_id", "place", "position", "kind"}))
        fields.update(saved=False, kind=body.kind or category_kind(place["category"]))
        result = store.upsert(con, tid, "stops", fields, rid=None if used else pid, place_id=pid)
        if body.position is not None:
            result = store.upsert(con, tid, "stops", {"position": body.position}, result["id"], place_id=pid)
        return visit(result)


@router.patch("/visits/{vid}")
def edit_visit(tid: int, vid: int, body: dict = Body(...)):
    if set(body).difference(SCHEDULE):
        raise HTTPException(422, "Hier können nur die Planungsdaten des Besuchs geändert werden.")
    with store.session(True) as con:
        current = visit_row(con, tid, vid)
        return visit(store.upsert(con, tid, "stops", body, vid, place_id=current["place_id"]))


def unschedule(con, tid, stop):
    if stop["id"] == stop["place_id"]:
        place = place_row(con, tid, stop["place_id"])
        store.upsert(con, tid, "stops", {"saved": True, "stage_id": None, "variant_id": None,
                     "date": None, "time": None, "end_date": None, "done": False, "kind": category_kind(place["category"])},
                     stop["id"], place_id=stop["place_id"])
    else:
        store.remove(con, tid, "stops", stop["id"])
        store.write_stop_order(con, store.records(con, tid, "stops"))


@router.delete("/visits/{vid}", status_code=204)
def delete_visit(tid: int, vid: int):
    with store.session(True) as con:
        unschedule(con, tid, visit_row(con, tid, vid))
    return Response(status_code=204)


@router.put("/visits/order")
def order_visits(tid: int, body: models.Order):
    with store.session(True) as con:
        store.trip(con, tid)
        stops = store.records(con, tid, "stops")
        current = {s["id"]: s for s in stops if not s["saved"]}
        if len(body.ids) != len(current) or set(body.ids) != set(current):
            raise HTTPException(409, "Die Reihenfolge muss alle aktuellen Besuche genau einmal enthalten.")
        store.write_stop_order(con, [current[vid] for vid in body.ids] + [s for s in stops if s["saved"]])
        return [visit(s) for s in store.records(con, tid, "stops") if not s["saved"]]
