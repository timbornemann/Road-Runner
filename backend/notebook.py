"""Planning topics, versioned Markdown notes, geographic areas and typed trip links."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import Field, model_validator

from . import models, places, store


router = APIRouter(prefix="/api/trips/{tid}/notebook")
Id = Annotated[int, Field(gt=0)]
Position = Annotated[int, Field(ge=0)]
Markdown = Annotated[str, Field(max_length=100000)]
SourceType = Literal["topic", "note"]
TargetType = Literal["topic", "note", "area", "stage", "variant", "stop", "purchase", "pantry",
                     "shopping", "mobility", "expense", "journal"]
RECORD_GROUPS = {"stop": "stops", "purchase": "purchases", "pantry": "pantry",
                 "shopping": "shopping", "mobility": "mobility", "expense": "expenses"}


class TopicCreate(models.Form):
    title: models.Name
    parent_id: Id | None = None


class Patch(models.Form):
    @model_validator(mode="after")
    def validate_changes(self):
        for field in self.model_fields_set:
            if field != "parent_id" and getattr(self, field) is None:
                raise ValueError(f"Ein gültiger Wert für {field} ist erforderlich.")
        return self


class TopicPatch(Patch):
    title: models.Name | None = None
    parent_id: Id | None = None
    position: Position | None = None


class NoteCreate(models.Form):
    topic_id: Id
    title: models.Name
    body: Markdown = ""


class NotePatch(Patch):
    revision: Id
    title: models.Name | None = None
    body: Markdown | None = None
    topic_id: Id | None = None
    position: Position | None = None


class AreaCreate(models.Form):
    name: models.Name
    stop_ids: list[Id] = Field(default_factory=list)


class AreaPatch(Patch):
    name: models.Name | None = None
    stop_ids: list[Id] | None = None


class Source(models.Form):
    source_type: SourceType
    source_id: Id


class LinkCreate(Source):
    target_type: TargetType
    target_id: Id


class LinkedTargetCreate(Source):
    target_type: Literal["stop", "place", "purchase"]
    fields: dict


def row(con, tid, table, item_id):
    item = con.execute(f"SELECT * FROM {table} WHERE trip_id=? AND id=?", (tid, item_id)).fetchone()
    if item is None:
        raise HTTPException(404, "Der Eintrag gehört nicht zu dieser Reise oder wurde gelöscht.")
    return dict(item)


def area_rows(con, tid, area_id=None):
    condition = " WHERE a.trip_id=?"
    params = [tid]
    if area_id is not None:
        condition += " AND a.id=?"
        params.append(area_id)
    areas = {a["id"]: dict(a, stop_ids=[]) for a in con.execute(
        "SELECT a.* FROM notebook_areas a" + condition + " ORDER BY a.name,a.id", params)}
    for link in con.execute("SELECT s.area_id,s.stop_id FROM notebook_area_stops s "
                            "JOIN notebook_areas a ON a.id=s.area_id" + condition + " ORDER BY s.position", params):
        areas[link["area_id"]]["stop_ids"].append(link["stop_id"])
    return list(areas.values())


def trip_data(con, tid):
    def all_rows(table, ordering):
        return [dict(r) for r in con.execute(f"SELECT * FROM {table} WHERE trip_id=? ORDER BY {ordering}", (tid,))]
    return {
        "topics": all_rows("notebook_topics", "parent_id,position,id"),
        "notes": all_rows("notebook_notes", "topic_id,position,id"),
        "areas": area_rows(con, tid),
        "links": all_rows("notebook_links", "id"),
    }


@router.get("")
def get_notebook(tid: int):
    with store.session() as con:
        store.trip(con, tid)
        return trip_data(con, tid)


def next_position(con, table, tid, parent_key, parent_id):
    return con.execute(f"SELECT coalesce(max(position)+1,0) FROM {table} WHERE trip_id=? AND {parent_key} IS ?",
                       (tid, parent_id)).fetchone()[0]


def order_siblings(con, table, tid, parent_key, parent_id, moved_id=None, index=None):
    siblings = [r[0] for r in con.execute(
        f"SELECT id FROM {table} WHERE trip_id=? AND {parent_key} IS ? AND id IS NOT ? ORDER BY position,id",
        (tid, parent_id, moved_id))]
    if moved_id is not None:
        siblings.insert(len(siblings) if index is None else min(index, len(siblings)), moved_id)
    changes = "position=:position"
    if table == "notebook_notes":
        # edit_note increments the active note's revision separately, including moves between topics.
        changes += ", revision=revision + (id IS NOT :moved_id)"
    con.executemany(f"UPDATE {table} SET {changes} WHERE id=:id AND position!=:position",
                    ({"position": pos, "id": rid, "moved_id": moved_id} for pos, rid in enumerate(siblings)))


def move(con, table, item, parent_key, new_parent, position):
    # The id/parent validation already happened in the same IMMEDIATE transaction.
    if item[parent_key] != new_parent:
        con.execute(f"UPDATE {table} SET {parent_key}=? WHERE id=?", (new_parent, item["id"]))
        order_siblings(con, table, item["trip_id"], parent_key, item[parent_key])
    order_siblings(con, table, item["trip_id"], parent_key, new_parent, item["id"], position)


@router.post("/topics", status_code=201)
def create_topic(tid: int, body: TopicCreate):
    with store.session(True) as con:
        store.trip(con, tid)
        if body.parent_id is not None:
            row(con, tid, "notebook_topics", body.parent_id)
        position = next_position(con, "notebook_topics", tid, "parent_id", body.parent_id)
        topic_id = con.execute("INSERT INTO notebook_topics(trip_id,parent_id,title,position) VALUES(?,?,?,?)",
                               (tid, body.parent_id, body.title, position)).lastrowid
        return row(con, tid, "notebook_topics", topic_id)


@router.patch("/topics/{id}")
def edit_topic(tid: int, id: int, body: TopicPatch):
    with store.session(True) as con:
        topic = row(con, tid, "notebook_topics", id)
        parent = body.parent_id if "parent_id" in body.model_fields_set else topic["parent_id"]
        if parent != topic["parent_id"] and parent is not None:
            row(con, tid, "notebook_topics", parent)
            cycle = con.execute("""WITH RECURSIVE ancestors(id,parent_id) AS (
                SELECT id,parent_id FROM notebook_topics WHERE id=? UNION ALL
                SELECT t.id,t.parent_id FROM notebook_topics t JOIN ancestors a ON a.parent_id=t.id
            ) SELECT 1 FROM ancestors WHERE id=?""", (parent, id)).fetchone()
            if cycle:
                raise HTTPException(409, "Ein Thema kann kein Unterthema von sich selbst werden.")
        if parent != topic["parent_id"] or body.position is not None:
            move(con, "notebook_topics", topic, "parent_id", parent, body.position)
        if body.title is not None:
            con.execute("UPDATE notebook_topics SET title=? WHERE id=?", (body.title, id))
        return row(con, tid, "notebook_topics", id)


@router.delete("/topics/{id}", status_code=204)
def delete_topic(tid: int, id: int):
    with store.session(True) as con:
        topic = row(con, tid, "notebook_topics", id)
        con.execute("DELETE FROM notebook_topics WHERE id=?", (id,))
        order_siblings(con, "notebook_topics", tid, "parent_id", topic["parent_id"])
    return Response(status_code=204)


@router.post("/notes", status_code=201)
def create_note(tid: int, body: NoteCreate):
    with store.session(True) as con:
        row(con, tid, "notebook_topics", body.topic_id)
        position = next_position(con, "notebook_notes", tid, "topic_id", body.topic_id)
        note_id = con.execute("INSERT INTO notebook_notes(trip_id,topic_id,title,body,position) VALUES(?,?,?,?,?)",
                              (tid, body.topic_id, body.title, body.body, position)).lastrowid
        return row(con, tid, "notebook_notes", note_id)


@router.get("/notes/{id}")
def get_note(tid: int, id: int):
    with store.session() as con:
        return row(con, tid, "notebook_notes", id)


def check_revision(note, revision):
    if revision != note["revision"]:
        raise HTTPException(409, "Diese Notiz wurde inzwischen geändert. Bitte die aktuelle Fassung vergleichen.")


@router.patch("/notes/{id}")
def edit_note(tid: int, id: int, body: NotePatch):
    with store.session(True) as con:
        note = row(con, tid, "notebook_notes", id)
        check_revision(note, body.revision)
        parent = body.topic_id or note["topic_id"]
        if parent != note["topic_id"]:
            row(con, tid, "notebook_topics", parent)
        if parent != note["topic_id"] or body.position is not None:
            move(con, "notebook_notes", note, "topic_id", parent, body.position)
        title = note["title"] if body.title is None else body.title
        content = note["body"] if body.body is None else body.body
        con.execute("UPDATE notebook_notes SET title=?,body=?,revision=revision+1 WHERE id=?", (title, content, id))
        return row(con, tid, "notebook_notes", id)


@router.delete("/notes/{id}", status_code=204)
def delete_note(tid: int, id: int, revision: int | None = None):
    with store.session(True) as con:
        note = row(con, tid, "notebook_notes", id)
        if revision is not None:
            check_revision(note, revision)
        con.execute("DELETE FROM notebook_notes WHERE id=?", (id,))
        order_siblings(con, "notebook_notes", tid, "topic_id", note["topic_id"])
    return Response(status_code=204)


def set_area_stops(con, tid, area_id, ids):
    con.execute("DELETE FROM notebook_area_stops WHERE area_id=?", (area_id,))
    for position, sid in enumerate(store.place_ids(con, tid, ids)):
        con.execute("INSERT INTO notebook_area_stops(area_id,stop_id,position) VALUES(?,?,?)",
                    (area_id, sid, position))


@router.post("/areas", status_code=201)
def create_area(tid: int, body: AreaCreate):
    with store.session(True) as con:
        store.trip(con, tid)
        area_id = con.execute("INSERT INTO notebook_areas(trip_id,name) VALUES(?,?)", (tid, body.name)).lastrowid
        set_area_stops(con, tid, area_id, body.stop_ids)
        return area_rows(con, tid, area_id)[0]


@router.patch("/areas/{id}")
def edit_area(tid: int, id: int, body: AreaPatch):
    with store.session(True) as con:
        row(con, tid, "notebook_areas", id)
        if body.name is not None:
            con.execute("UPDATE notebook_areas SET name=? WHERE id=?", (body.name, id))
        if body.stop_ids is not None:
            set_area_stops(con, tid, id, body.stop_ids)
        return area_rows(con, tid, id)[0]


@router.delete("/areas/{id}", status_code=204)
def delete_area(tid: int, id: int):
    with store.session(True) as con:
        row(con, tid, "notebook_areas", id)
        con.execute("DELETE FROM notebook_areas WHERE id=?", (id,))
    return Response(status_code=204)


def target_title(con, tid, kind, id):
    if kind in RECORD_GROUPS:
        record = store.record(con, tid, RECORD_GROUPS[kind], id)
        return record.get("title") or record["name"]
    if kind == "variant":
        variant = con.execute("""SELECT v.name FROM stage_variants v JOIN stages s ON s.id=v.stage_id
            WHERE v.id=? AND s.trip_id=?""", (id, tid)).fetchone()
        if variant is None:
            raise HTTPException(404, "Variante in dieser Reise nicht gefunden.")
        return variant["name"]
    table = {"topic": "notebook_topics", "note": "notebook_notes", "area": "notebook_areas",
             "stage": "stages", "journal": "journal_entries"}.get(kind)
    if table is None:
        raise HTTPException(422, "Unbekannter Zieltyp.")
    item = row(con, tid, table, id)
    return item.get("title") or item.get("name") or item["date"]


def add_link(con, tid, body):
    if body.target_type == "stop":
        body = body.model_copy(update={"target_id": store.place_ids(con, tid, [body.target_id])[0]})
    target_title(con, tid, body.source_type, body.source_id)
    target_title(con, tid, body.target_type, body.target_id)
    if body.source_type == body.target_type and body.source_id == body.target_id:
        raise HTTPException(422, "Bitte einen anderen Eintrag als Ziel auswählen.")
    values = (tid, body.source_type, body.source_id, body.target_type, body.target_id)
    con.execute("""INSERT INTO notebook_links(trip_id,source_type,source_id,target_type,target_id)
        VALUES(?,?,?,?,?) ON CONFLICT(trip_id,source_type,source_id,target_type,target_id) DO NOTHING""", values)
    return dict(con.execute("""SELECT * FROM notebook_links WHERE trip_id=? AND source_type=? AND source_id=?
        AND target_type=? AND target_id=?""", values).fetchone())


@router.post("/links", status_code=201)
def create_link(tid: int, body: LinkCreate):
    with store.session(True) as con:
        return add_link(con, tid, body)


@router.post("/links/create-target", status_code=201)
def create_target(tid: int, body: LinkedTargetCreate):
    with store.session(True) as con:
        kind = body.target_type
        if kind == "place":
            record = places.save_place(con, tid, body.fields)[0]
            kind = "stop"
        else:
            record = store.upsert(con, tid, RECORD_GROUPS[kind], body.fields)
        link = add_link(con, tid, LinkCreate(source_type=body.source_type, source_id=body.source_id,
                        target_type=kind, target_id=record["id"]))
        return {"target": record, "link": link}


@router.delete("/links/{id}", status_code=204)
def delete_link(tid: int, id: int):
    with store.session(True) as con:
        row(con, tid, "notebook_links", id)
        con.execute("DELETE FROM notebook_links WHERE id=?", (id,))
    return Response(status_code=204)
