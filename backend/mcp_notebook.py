"""Trip planning notebook tools for MCP clients."""

from typing import Annotated, Any, Literal

from fastapi import HTTPException
from pydantic import Field

from . import models, notebook, store
from .mcp_tools import CREATE, EDIT, READ, Limit, Offset, PositiveId, _page, domain_tool


EntryKind = Literal["topic", "note", "area"]
TextLimit = Annotated[int, Field(ge=1, le=16000)]


def search_notebook(trip_id: PositiveId, query: models.Short = "", kind: EntryKind | None = None,
                    topic_id: PositiveId | None = None, offset: Offset = 0, limit: Limit = 20) -> dict[str, Any]:
    """Finde Themen, Notizen und Gebiete einer Reise anhand von Titel oder Notiztext.

    Ohne Suchbegriff liefert das Werkzeug das Inhaltsverzeichnis mit Eltern-IDs, Position und
    Themenpfad. Mit topic_id erscheinen die unmittelbaren Unterthemen und Notizen dieses Themas.
    Lange Notiztexte und die Orte eines Gebiets sind über die separaten Lesewerkzeuge abrufbar.
    """
    with store.session() as con:
        store.trip(con, trip_id)
        topics = {row["id"]: row for row in con.execute(
            "SELECT id,parent_id,title FROM notebook_topics WHERE trip_id=?", (trip_id,))}
        if topic_id is not None and topic_id not in topics:
            raise HTTPException(404, "Thema in dieser Reise nicht gefunden.")
        con.create_function("casefold", 1, str.casefold, deterministic=True)
        params = {"tid": trip_id, "q": query.strip().casefold(), "parent": topic_id, "kind": kind,
                  "limit": limit, "offset": offset}
        listing = """WITH entries(kind,id,title,parent,position,revision,body,section) AS (
            SELECT 'topic',id,title,parent_id,position,NULL,'',1 FROM notebook_topics WHERE trip_id=:tid
            UNION ALL SELECT 'note',id,title,topic_id,position,revision,body,2 FROM notebook_notes WHERE trip_id=:tid
            UNION ALL SELECT 'area',id,name,NULL,NULL,NULL,'',3 FROM notebook_areas WHERE trip_id=:tid)
        """
        where = """ FROM entries WHERE (:kind IS NULL OR kind=:kind) AND (:parent IS NULL OR parent=:parent)
            AND (:q='' OR instr(casefold(title),:q) OR instr(casefold(body),:q))"""
        total = con.execute(listing + "SELECT count(*)" + where, params).fetchone()[0]
        page = con.execute(listing + "SELECT kind,id,title,parent,position,revision" + where +
                           " ORDER BY section,parent,position,title,id LIMIT :limit OFFSET :offset", params)
        items = []
        for row in page:
            item = {"kind": row["kind"], "id": row["id"], "title": row["title"]}
            if row["kind"] == "topic":
                item.update(parent_id=row["parent"], position=row["position"])
            if row["kind"] == "note":
                item.update(topic_id=row["parent"], position=row["position"], revision=row["revision"])
            current = row["id"] if row["kind"] == "topic" else row["parent"]
            path = []
            while current is not None:
                path.append(topics[current]["title"])
                current = topics[current]["parent_id"]
            item["topic_path"] = path[::-1]
            items.append(item)
    return _page(items, total, offset, limit)


def read_notebook_note(trip_id: PositiveId, note_id: PositiveId, text_offset: Offset = 0,
                       text_limit: TextLimit = 8000) -> dict[str, Any]:
    """Lies den Markdown-Text und die Bearbeitungsrevision einer Notiz.

    Für den vollständigen Text allen next_text_offset folgen. Verknüpfungen stehen unter
    list_notebook_links mit kind=note zur Verfügung.
    """
    note = notebook.get_note(trip_id, note_id)
    body = note["body"]
    end = text_offset + text_limit
    return {**note, "body": body[text_offset:end], "text_length": len(body),
            "next_text_offset": end if end < len(body) else None}


def read_notebook_area(trip_id: PositiveId, area_id: PositiveId, offset: Offset = 0,
                       limit: Limit = 20) -> dict[str, Any]:
    """Lies ein Gebiet und seine zugeordneten Orte, einschließlich vorgemerkter Ziele."""
    with store.session() as con:
        title = notebook.target_title(con, trip_id, "area", area_id)
        total = con.execute("SELECT count(*) FROM notebook_area_stops WHERE area_id=?", (area_id,)).fetchone()[0]
        ids = con.execute("SELECT stop_id FROM notebook_area_stops WHERE area_id=? ORDER BY position LIMIT ? OFFSET ?",
                          (area_id, limit, offset))
        places = [{"id": sid, "title": notebook.target_title(con, trip_id, "stop", sid)} for (sid,) in ids]
        return {"id": area_id, "trip_id": trip_id, "name": title, **_page(places, total, offset, limit)}


def list_notebook_links(trip_id: PositiveId, kind: notebook.TargetType, item_id: PositiveId,
                        offset: Offset = 0, limit: Limit = 20) -> dict[str, Any]:
    """Lies alle ein- und ausgehenden Heftverweise eines Reiseeintrags mit aktuellen Titeln und IDs.

    So findest du beispielsweise vom Typ purchase zur Planungsnotiz zurück, die den Kauf erklärt.
    """
    with store.session() as con:
        title = notebook.target_title(con, trip_id, kind, item_id)
        where = " FROM notebook_links WHERE trip_id=? AND ((source_type=? AND source_id=?) OR (target_type=? AND target_id=?))"
        params = (trip_id, kind, item_id, kind, item_id)
        total = con.execute("SELECT count(*)" + where, params).fetchone()[0]
        links = con.execute("SELECT *" + where + " ORDER BY id LIMIT ? OFFSET ?", (*params, limit, offset))
        page = []
        for link in links:
            page.append({**link,
                "source_title": notebook.target_title(con, trip_id, link["source_type"], link["source_id"]),
                "target_title": notebook.target_title(con, trip_id, link["target_type"], link["target_id"]),
            })
        return {"title": title, **_page(page, total, offset, limit)}


def create_notebook_topic(trip_id: PositiveId, topic: notebook.TopicCreate) -> dict[str, Any]:
    """Lege ein Thema an der Wurzel oder mit parent_id als Unterthema an."""
    return notebook.create_topic(trip_id, topic)


def update_notebook_topic(trip_id: PositiveId, topic_id: PositiveId, changes: notebook.TopicPatch) -> dict[str, Any]:
    """Benenne ein Thema um, ändere seine Position oder verschiebe es mit parent_id. Null bedeutet Wurzel."""
    return notebook.edit_topic(trip_id, topic_id, changes)


def create_notebook_note(trip_id: PositiveId, note: notebook.NoteCreate) -> dict[str, Any]:
    """Lege eine Notiz mit Titel und Markdown im gewählten Thema an. Checkboxen verwenden '- [ ] Aufgabe'."""
    created = notebook.create_note(trip_id, note)
    return {key: created[key] for key in ("id", "title", "topic_id", "position", "revision")}


def update_notebook_note(trip_id: PositiveId, note_id: PositiveId, changes: notebook.NotePatch) -> dict[str, Any]:
    """Ändere Titel, Text, Thema oder Position mit der zuletzt gelesenen Revision.

    body ersetzt den gesamten Markdown-Text samt Checklisten. Lies vor einem Text-Update alle
    Textseiten. Bei einem Versionskonflikt die aktuelle Notiz lesen und Änderungen abgleichen.
    """
    updated = notebook.edit_note(trip_id, note_id, changes)
    return {key: updated[key] for key in ("id", "title", "topic_id", "position", "revision")}


def create_notebook_area(trip_id: PositiveId, area: notebook.AreaCreate) -> dict[str, Any]:
    """Lege ein benanntes Gebiet an und ordne ihm auf Wunsch Orts-IDs aus derselben Reise zu."""
    return notebook.create_area(trip_id, area)


def update_notebook_area(trip_id: PositiveId, area_id: PositiveId, changes: notebook.AreaPatch) -> dict[str, Any]:
    """Benenne ein Gebiet um oder ersetze seine Ortszuordnungen durch die übergebenen stop_ids."""
    return notebook.edit_area(trip_id, area_id, changes)


def create_notebook_link(trip_id: PositiveId, link: notebook.LinkCreate) -> dict[str, Any]:
    """Verknüpfe ein Thema oder eine Notiz mit einem vorhandenen Ziel derselben Reise."""
    return notebook.create_link(trip_id, link)


def create_linked_notebook_target(trip_id: PositiveId, target: notebook.LinkedTargetCreate) -> dict[str, Any]:
    """Erstelle in einem Schritt einen Ort oder eine Anschaffung und verknüpfe den Eintrag mit dem Heft.

    fields entspricht den Daten aus create_stop bzw. save_purchase. Bei einer Anschaffung
    übernimmt die gemeinsame Buchungslogik den Finanzposten.
    """
    return notebook.create_target(trip_id, target)


def delete_notebook_item(trip_id: PositiveId, kind: Literal["topic", "note", "area", "link"],
                         item_id: PositiveId, revision: PositiveId | None = None) -> dict[str, Any]:
    """Lösche einen Hefteintrag oder eine Verknüpfung. Ein Thema löscht auch seine Unterthemen und Notizen.

    Bei einzelnen Notizen die aktuelle revision angeben. Verknüpfte Reiseobjekte bleiben erhalten.
    """
    if kind == "note":
        if revision is None:
            raise HTTPException(422, "Zum Löschen die aktuelle Revision der Notiz angeben.")
        notebook.delete_note(trip_id, item_id, revision)
    else:
        delete = {"topic": notebook.delete_topic, "area": notebook.delete_area, "link": notebook.delete_link}
        delete[kind](trip_id, item_id)
    return {"kind": kind, "deleted_id": item_id}


def register_notebook_tools(server, read_only=False):
    for function in (search_notebook, read_notebook_note, read_notebook_area, list_notebook_links):
        domain_tool(server, READ)(function)
    if read_only:
        return
    for function in (create_notebook_topic, create_notebook_note, create_notebook_area,
                     create_notebook_link, create_linked_notebook_target):
        domain_tool(server, CREATE)(function)
    for function in (update_notebook_topic, update_notebook_note, update_notebook_area, delete_notebook_item):
        domain_tool(server, EDIT)(function)
