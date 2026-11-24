"""Ordered trip stages, their alternative routes and stop membership."""

from fastapi import APIRouter, Body, HTTPException, Response

from . import models, store


router = APIRouter(prefix="/api/trips/{tid}/stages")


class Description(models.Form):
    name: models.Name
    notes: models.Note = ""


def migrate(con):
    con.execute("""CREATE TABLE IF NOT EXISTS stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
        active_variant_id INTEGER REFERENCES stage_variants(id) ON DELETE SET NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS stage_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT, stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '')""")
    con.execute("CREATE INDEX IF NOT EXISTS stages_trip ON stages(trip_id,position)")
    con.execute("CREATE INDEX IF NOT EXISTS variants_stage ON stage_variants(stage_id)")
    con.execute("""UPDATE records SET data=json_insert(data, '$.stage_id', NULL, '$.variant_id', NULL)
        WHERE collection='stops'""")


def stage_data(con, tid):
    stages = {row["id"]: dict(row, variants=[]) for row in con.execute(
        "SELECT * FROM stages WHERE trip_id=? ORDER BY position,id", (tid,))}
    for row in con.execute("""SELECT v.* FROM stage_variants v JOIN stages s ON s.id=v.stage_id
            WHERE s.trip_id=? ORDER BY v.id""", (tid,)):
        stages[row["stage_id"]]["variants"].append(dict(row))
    return list(stages.values())


def get_stage(con, tid, sid):
    row = con.execute("SELECT * FROM stages WHERE trip_id=? AND id=?", (tid, sid)).fetchone()
    if not row:
        raise HTTPException(404, "Etappe nicht gefunden.")
    return row


def get_variant(con, sid, vid):
    row = con.execute("SELECT * FROM stage_variants WHERE stage_id=? AND id=?", (sid, vid)).fetchone()
    if not row:
        raise HTTPException(404, "Variante in dieser Etappe nicht gefunden.")
    return row


def validate_stop(con, tid, stop):
    if stop["stage_id"] is not None:
        get_stage(con, tid, stop["stage_id"])
    if stop["variant_id"] is not None:
        get_variant(con, stop["stage_id"], stop["variant_id"])


@router.get("")
def list_stages(tid: int):
    with store.session() as con:
        store.trip(con, tid)
        return stage_data(con, tid)


@router.post("", status_code=201)
def create_stage(tid: int, body: Description):
    with store.session(True) as con:
        store.trip(con, tid)
        sid = con.execute("""INSERT INTO stages(trip_id,name,notes,position)
            SELECT ?,?,?,COALESCE(MAX(position)+1,0) FROM stages WHERE trip_id=?""",
            (tid, body.name, body.notes, tid)).lastrowid
        return dict(get_stage(con, tid, sid), variants=[])


@router.put("/order")
def order_stages(tid: int, body: models.Order):
    with store.session(True) as con:
        store.trip(con, tid)
        ids = [row["id"] for row in con.execute("SELECT id FROM stages WHERE trip_id=?", (tid,))]
        if sorted(body.ids) != sorted(ids):
            raise HTTPException(409, "Die Reihenfolge muss alle Etappen genau einmal enthalten.")
        con.executemany("UPDATE stages SET position=? WHERE id=?", enumerate(body.ids))
        return stage_data(con, tid)


@router.patch("/{sid}")
def edit_stage(tid: int, sid: int, body: dict = Body(...)):
    with store.session(True) as con:
        values = store.validated(Description, body, dict(get_stage(con, tid, sid)))
        con.execute("UPDATE stages SET name=?,notes=? WHERE id=?", (values["name"], values["notes"], sid))
        return dict(get_stage(con, tid, sid))


def detach_stops(con, tid, stage, variant=None):
    # The chosen route stays in the itinerary. Unused alternatives become saved places.
    stops = store.records(con, tid, "stops")
    order = {stop["id"]: index for index, stop in enumerate(stops)}
    for stop in stops:
        if stop["stage_id"] != stage["id"] or (variant is not None and stop["variant_id"] != variant):
            continue
        unused = stop["variant_id"] is not None and stop["variant_id"] != stage["active_variant_id"]
        if unused and store.SCHEMA_VERSION >= 5:
            from . import places
            places.unschedule(con, tid, stop)
            continue
        store.put(con, tid, "stops", {**stop, "variant_id": None,
            "stage_id": None if variant is None or unused else stage["id"], "saved": stop["saved"] or unused})
    remaining = sorted(store.records(con, tid, "stops"), key=lambda s: (s["saved"], order[s["id"]]))
    store.write_stop_order(con, remaining)


@router.delete("/{sid}", status_code=204)
def delete_stage(tid: int, sid: int):
    with store.session(True) as con:
        stage = get_stage(con, tid, sid)
        detach_stops(con, tid, stage)
        con.execute("DELETE FROM stages WHERE id=?", (sid,))
    return Response(status_code=204)


@router.post("/{sid}/variants", status_code=201)
def create_variant(tid: int, sid: int, body: Description):
    with store.session(True) as con:
        stage = get_stage(con, tid, sid)
        vid = con.execute("INSERT INTO stage_variants(stage_id,name,notes) VALUES(?,?,?)",
                          (sid, body.name, body.notes)).lastrowid
        if stage["active_variant_id"] is None:
            con.execute("UPDATE stages SET active_variant_id=? WHERE id=?", (vid, sid))
        return dict(get_variant(con, sid, vid))


@router.patch("/{sid}/variants/{vid}")
def edit_variant(tid: int, sid: int, vid: int, body: dict = Body(...)):
    with store.session(True) as con:
        get_stage(con, tid, sid)
        values = store.validated(Description, body, dict(get_variant(con, sid, vid)))
        con.execute("UPDATE stage_variants SET name=?,notes=? WHERE id=?", (values["name"], values["notes"], vid))
        return dict(get_variant(con, sid, vid))


@router.put("/{sid}/variants/{vid}/activate")
def activate_variant(tid: int, sid: int, vid: int):
    with store.session(True) as con:
        get_stage(con, tid, sid)
        get_variant(con, sid, vid)
        con.execute("UPDATE stages SET active_variant_id=? WHERE id=?", (vid, sid))
        return dict(get_stage(con, tid, sid))


@router.delete("/{sid}/variants/{vid}", status_code=204)
def delete_variant(tid: int, sid: int, vid: int):
    with store.session(True) as con:
        stage = get_stage(con, tid, sid)
        get_variant(con, sid, vid)
        detach_stops(con, tid, stage, vid)
        con.execute("DELETE FROM stage_variants WHERE id=?", (vid,))
        if stage["active_variant_id"] == vid:
            con.execute("""UPDATE stages SET active_variant_id=(
                SELECT MIN(id) FROM stage_variants WHERE stage_id=?) WHERE id=?""", (sid, sid))
    return Response(status_code=204)
