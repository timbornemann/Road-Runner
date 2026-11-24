"""Dated travel notes, their ordered place links and reusable favorite places."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response
from pydantic import Field, StringConstraints
from starlette.concurrency import run_in_threadpool

from . import journal_media, models, places, store


router = APIRouter()
router.include_router(journal_media.router)


def migrate(con):
    statements = (
        """CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE,
            date TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS journal_trip_date ON journal_entries(trip_id,date,id)",
        """CREATE TABLE IF NOT EXISTS journal_places (
            entry_id INTEGER NOT NULL REFERENCES journal_entries ON DELETE CASCADE,
            stop_id INTEGER NOT NULL REFERENCES records ON DELETE CASCADE, position INTEGER NOT NULL,
            PRIMARY KEY(entry_id,stop_id))""",
        """CREATE TABLE IF NOT EXISTS journal_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entries ON DELETE CASCADE,
            filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL,
            content BLOB NOT NULL, UNIQUE(entry_id,digest))""",
        "CREATE INDEX IF NOT EXISTS media_entry ON journal_media(entry_id,id)",
        """CREATE TABLE IF NOT EXISTS favorite_stops (
            stop_id INTEGER PRIMARY KEY REFERENCES records ON DELETE CASCADE)""",
        """CREATE TABLE IF NOT EXISTS favorite_copies (
            trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE,
            source_stop_id INTEGER NOT NULL REFERENCES records ON DELETE CASCADE,
            stop_id INTEGER NOT NULL REFERENCES records ON DELETE CASCADE, PRIMARY KEY(trip_id,source_stop_id))""",
    )
    for statement in statements:
        con.execute(statement)


class JournalEntry(models.Form):
    date: dt.date
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=250)] = ""
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100000)] = ""
    stop_ids: list[Annotated[int, Field(gt=0)]] = Field(default_factory=list)


def entries(con, tid, eid=None):
    # Each table is fetched in one pass, including for a whole trip.
    where = " WHERE e.trip_id=?"
    params = [tid]
    if eid is not None:
        where += " AND e.id=?"
        params.append(eid)
    rows = con.execute("SELECT e.* FROM journal_entries e" + where + " ORDER BY e.date,e.id", params)
    notes = {r["id"]: {**dict(r), "stop_ids": [], "media": []} for r in rows}
    links = con.execute("SELECT p.entry_id,p.stop_id FROM journal_places p JOIN journal_entries e ON e.id=p.entry_id"
                        + where + " ORDER BY p.entry_id,p.position", params)
    for link in links:
        notes[link["entry_id"]]["stop_ids"].append(link["stop_id"])
    attachments = con.execute("SELECT m.id,m.entry_id,m.filename,m.mime_type,m.size FROM journal_media m "
                              "JOIN journal_entries e ON e.id=m.entry_id" + where + " ORDER BY m.id", params)
    for media in attachments:
        notes[media["entry_id"]]["media"].append(journal_media.describe(tid, media))
    return list(notes.values())


def get_entry(con, tid, eid):
    notes = entries(con, tid, eid)
    if not notes:
        raise HTTPException(404, "Tagebucheintrag nicht gefunden.")
    return notes[0]


def trip_data(con, tid):
    favorites = con.execute("SELECT f.stop_id FROM favorite_stops f JOIN records r ON r.id=f.stop_id "
                            "WHERE r.trip_id=? ORDER BY f.stop_id", (tid,))
    return {"journal_entries": entries(con, tid), "favorite_stop_ids": [r["stop_id"] for r in favorites]}


def save_links(con, tid, eid, stop_ids):
    con.execute("DELETE FROM journal_places WHERE entry_id=?", (eid,))
    ids = store.place_ids(con, tid, stop_ids)
    for index, sid in enumerate(ids):
        con.execute("INSERT INTO journal_places(entry_id,stop_id,position) VALUES(?,?,?)", (eid, sid, index))


@router.get("/api/trips/{tid}/journal")
def list_entries(tid: int):
    with store.session() as con:
        store.trip(con, tid)
        return entries(con, tid)


def create_entry(con, tid, body: JournalEntry):
    store.trip(con, tid)
    eid = con.execute("INSERT INTO journal_entries(trip_id,date,title,text) VALUES(?,?,?,?)",
                      (tid, body.date.isoformat(), body.title, body.text)).lastrowid
    save_links(con, tid, eid, body.stop_ids)
    return get_entry(con, tid, eid)


@router.post("/api/trips/{tid}/journal", status_code=201)
def add_entry(tid: int, body: JournalEntry):
    with store.session(True) as con:
        return create_entry(con, tid, body)


@router.post("/api/trips/{tid}/journal/with-media", status_code=201)
async def add_media_entry(tid: int, date: dt.date, request: Request, filename: str = Query(min_length=1, max_length=255)):
    def create_with_attachment(*media):
        with store.session(True) as con:
            note = create_entry(con, tid, JournalEntry(date=date))
            note["media"].append(journal_media.save_upload(con, tid, note["id"], *media))
            return note

    await run_in_threadpool(journal_media.check_destination, tid)
    async with journal_media.received_file(request, filename) as media:
        return await run_in_threadpool(create_with_attachment, *media)


@router.patch("/api/trips/{tid}/journal/{eid}")
def edit_entry(tid: int, eid: int, body: dict = Body(...)):
    with store.session(True) as con:
        original = get_entry(con, tid, eid)
        data = store.validated(JournalEntry, body, original)
        con.execute("UPDATE journal_entries SET date=?,title=?,text=? WHERE id=?",
                    (data["date"], data["title"], data["text"], eid))
        if "stop_ids" in body:
            save_links(con, tid, eid, data["stop_ids"])
        return get_entry(con, tid, eid)


@router.delete("/api/trips/{tid}/journal/{eid}", status_code=204)
def delete_entry(tid: int, eid: int):
    with store.session(True) as con:
        if not con.execute("DELETE FROM journal_entries WHERE trip_id=? AND id=?", (tid, eid)).rowcount:
            raise HTTPException(404, "Tagebucheintrag nicht gefunden.")
    return Response(status_code=204)


@router.get("/api/favorites")
def list_favorites():
    with store.session() as con:
        rows = con.execute("SELECT r.*,json_extract(t.data,'$.name') AS trip_name FROM favorite_stops f "
                           "JOIN records r ON r.id=f.stop_id JOIN trips t ON t.id=r.trip_id "
                           "ORDER BY trip_name,json_extract(r.data,'$.title'),r.id")
        destinations = {}
        for copy in con.execute("SELECT source_stop_id,trip_id FROM favorite_copies ORDER BY trip_id"):
            destinations.setdefault(copy["source_stop_id"], []).append(copy["trip_id"])
        return [{"stop": store.unpack(r), "trip_id": r["trip_id"], "trip_name": r["trip_name"],
                 "copied_to_trip_ids": destinations.get(r["id"], [])} for r in rows]


@router.put("/api/trips/{tid}/favorites/{sid}", status_code=204)
def add_favorite(tid: int, sid: int):
    with store.session(True) as con:
        sid = store.place_ids(con, tid, [sid])[0]
        con.execute("INSERT OR IGNORE INTO favorite_stops(stop_id) VALUES(?)", (sid,))
    return Response(status_code=204)


@router.delete("/api/trips/{tid}/favorites/{sid}", status_code=204)
def remove_favorite(tid: int, sid: int):
    with store.session(True) as con:
        sid = store.place_ids(con, tid, [sid])[0]
        con.execute("DELETE FROM favorite_stops WHERE stop_id=?", (sid,))
    return Response(status_code=204)


@router.post("/api/trips/{tid}/favorites/{sid}/copy")
def copy_favorite(tid: int, sid: int):
    with store.session(True) as con:
        store.trip(con, tid)
        row = con.execute("""SELECT r.* FROM records handle JOIN favorite_stops f
            ON f.stop_id=COALESCE(json_extract(handle.data,'$.place_id'),handle.id)
            JOIN records r ON r.id=f.stop_id WHERE handle.collection='stops' AND handle.id=?""", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "Lieblingsplatz nicht gefunden.")
        source = store.unpack(row)
        sid = source["id"]
        if source["trip_id"] == tid:
            return source
        previous = con.execute("SELECT stop_id FROM favorite_copies WHERE trip_id=? AND source_stop_id=?",
                               (tid, sid)).fetchone()
        if previous:
            return store.record(con, tid, "stops", previous["stop_id"])
        source_place = places.place_row(con, source["trip_id"], sid)
        fields = {k: source_place[k] for k in places.Place.model_fields}
        dest, created = places.save_place(con, tid, fields)
        if created:
            con.execute("""INSERT INTO place_images(place_id,filename,mime_type,size,content)
                SELECT ?,filename,mime_type,size,content FROM place_images WHERE place_id=?""", (dest["id"], sid))
        result = store.record(con, tid, "stops", dest["id"])
        con.execute("INSERT INTO favorite_copies(trip_id,source_stop_id,stop_id) VALUES(?,?,?)", (tid, sid, result["id"]))
        return result
