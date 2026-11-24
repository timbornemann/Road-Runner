"""Trip planning tools shared by Streamable HTTP MCP clients."""

import datetime as dt
import json
from functools import wraps
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field, ValidationError, create_model

from . import journal, models, stages, store


READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
CREATE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
EDIT = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False)

PositiveId = Annotated[int, Field(gt=0)]
Offset = Annotated[int, Field(ge=0)]
Limit = Annotated[int, Field(ge=1, le=50)]
Section = Literal["itinerary", "stops", "wishlist", "stages", "purchases", "shopping", "pantry",
                  "mobility", "expenses", "journal"]


def partial_fields(model):
    """Describe PATCH keys without running whole-record validators before merging with the saved record."""
    fields = {name: (field.rebuild_annotation(), Field(default_factory=lambda: None))
              for name, field in model.model_fields.items()}
    return create_model(model.__name__ + "Changes", __base__=models.Form, **fields)


TripChanges = partial_fields(models.Trip)
StopChanges = partial_fields(models.Stop)
DescriptionChanges = partial_fields(stages.Description)


def domain_tool(server, annotations):
    """Expose actionable domain validation errors while letting unexpected failures stay private."""
    def register(function):
        @wraps(function)
        def call(**kwargs):
            try:
                return function(**kwargs)
            except HTTPException as exc:
                raise ToolError(str(exc.detail)) from exc
            except ValidationError as exc:
                raise ToolError(models.validation_message(exc.errors())) from exc

        return server.tool(annotations=annotations)(call)
    return register


def _page(items, total, offset, limit):
    # Long notes or receipt line items can exhaust a client's context even on a small page.
    # Always deliver one complete item, then let the client follow next_offset for the rest.
    result = []
    size = 0
    for item in items:
        size += len(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        if result and size > 32_000:
            break
        result.append(item)
    end = offset + len(result)
    return {"items": result, "total": total, "offset": offset, "limit": limit,
            "next_offset": end if end < total else None}


def list_trips(offset: Offset = 0, limit: Limit = 20) -> dict[str, Any]:
    """List trips (including the marked demo) with stable IDs, dates, region and base currency."""
    with store.session() as con:
        total = con.execute("SELECT count(*) FROM trips").fetchone()[0]
        rows = con.execute("SELECT * FROM trips ORDER BY id LIMIT ? OFFSET ?", (limit, offset))
        items = [store.unpack(row) for row in rows]
    for item in items:
        item.pop("description", None)
    return _page(items, total, offset, limit)


def _active_route(stops, trip_stages):
    """Keep exactly the same variant selection and ordering as shared.activeRoute in the web app."""
    stage_by_id = {stage["id"]: stage for stage in trip_stages}
    active = [stop for stop in stops if not stop["saved"] and
              (stop["variant_id"] is None or
               stop["variant_id"] == stage_by_id[stop["stage_id"]]["active_variant_id"])]
    def position(stop):
        stage = stage_by_id.get(stop["stage_id"])
        return (stage["position"] if stage else float("inf"), stop["position"], stop["id"])
    return sorted(active, key=position)


def _brief(stop):
    if stop is None:
        return None
    return {key: stop[key] for key in ("id", "place_id", "title", "kind", "date", "time", "end_date", "address",
                                       "stage_id", "variant_id")}


def _wishlist(stops):
    planned = {s["place_id"] for s in stops if not s["saved"]}
    return [s for s in stops if s["id"] == s["place_id"] and s["id"] not in planned]


def get_trip(trip_id: PositiveId) -> dict[str, Any]:
    """Read a planning overview, including paid/planned/available budget in base currency and next stops."""
    with store.session() as con:
        trip = store.trip(con, trip_id)
        trip_stages = stages.stage_data(con, trip_id)
        stops = store.records(con, trip_id, "stops")
        route = _active_route(stops, trip_stages)
        counts = dict.fromkeys(store.COLLECTIONS, 0)
        counts.update(con.execute("SELECT collection,count(*) FROM records WHERE trip_id=? GROUP BY collection",
                                  (trip_id,)).fetchall())
        counts["stages"] = len(trip_stages)
        counts["itinerary"] = len(route)
        counts["wishlist"] = len(_wishlist(stops))
        counts["places"] = sum(s["id"] == s["place_id"] for s in stops)
        counts["visits"] = sum(not s["saved"] for s in stops)
        counts["journal"] = con.execute("SELECT count(*) FROM journal_entries WHERE trip_id=?", (trip_id,)).fetchone()[0]
        costs = store.records(con, trip_id, "expenses")
    # SQLite stores cents. Sum only the shared ledger so linked purchases and rides count once.
    paid = sum(store.cents(e["base_amount"]) for e in costs if e["status"] == "paid")
    planned = sum(store.cents(e["base_amount"]) for e in costs if e["status"] == "planned")
    pending = [stop for stop in route if not stop["done"]]
    today = dt.date.today().isoformat()
    sleep = next((s for s in route if s["kind"] == "sleep" and s["date"] and s["end_date"] and
                  s["date"] <= today < s["end_date"]), None)
    if sleep is None:
        sleep = next((s for s in pending if s["kind"] == "sleep"), None)
    return {
        "trip": trip,
        "counts": counts,
        "next_stop": _brief(pending[0] if pending else None),
        "sleep_stop": _brief(sleep),
        "budget": {
            "currency": trip["currency"], "paid": paid / 100, "planned": planned / 100,
            "available": (store.cents(trip["budget"]) - paid - planned) / 100,
        },
    }


def _journal_page(con, trip_id, date, offset, limit):
    params = [trip_id]
    where = "WHERE trip_id=?"
    if date is not None:
        where += " AND date=?"
        params.append(date.isoformat())
    total = con.execute("SELECT count(*) FROM journal_entries " + where, params).fetchone()[0]
    ids = con.execute("SELECT id FROM journal_entries " + where + " ORDER BY date,id LIMIT ? OFFSET ?",
                      [*params, limit, offset])
    items = []
    for row in ids:
        entry = journal.get_entry(con, trip_id, row["id"])
        text = entry.pop("text")
        entry.update(text_preview=text[:320], text_length=len(text))
        items.append(entry)
    return _page(items, total, offset, limit)


def read_trip_section(trip_id: PositiveId, section: Section, offset: Offset = 0, limit: Limit = 20,
                      tag: str | None = None, date: dt.date | None = None) -> dict[str, Any]:
    """Page through one trip section. itinerary is the chosen route in travel order with flexible and dated
    stops. stops includes every alternative and saved place in position order. wishlist contains saved places.
    stages includes variant IDs, notes and the active choice. Filter tagged records by exact tag or dated
    records by their stored day. Journal pages include text previews, place IDs and attachment metadata.
    Follow next_offset until null to read all matches, including when large records shorten a page."""
    if tag is not None and section in ("stages", "journal"):
        raise ToolError("Dieser Bereich verwendet keine Tags.")
    if date is not None and section in ("stages", "pantry", "shopping"):
        raise ToolError("Dieser Bereich verwendet kein Datum.")
    with store.session() as con:
        store.trip(con, trip_id)
        if section == "journal":
            return _journal_page(con, trip_id, date, offset, limit)
        if section == "stages":
            items = stages.stage_data(con, trip_id)
        elif section in ("itinerary", "wishlist"):
            stops = store.records(con, trip_id, "stops")
            items = (_active_route(stops, stages.stage_data(con, trip_id)) if section == "itinerary"
                     else _wishlist(stops))
        else:
            items = store.records(con, trip_id, section)
    if tag is not None:
        key = tag.strip().casefold()
        items = [item for item in items if any(value.casefold() == key for value in item["tags"])]
    if date is not None:
        items = [item for item in items if item["date"] == date.isoformat()]
    return _page(items[offset:offset + limit], len(items), offset, limit)


def create_trip(trip: models.Trip) -> dict[str, Any]:
    """Create a trip. Only name is required. Dates are optional and the default base currency is EUR."""
    with store.session(True) as con:
        return store.create_trip(con, trip.model_dump())


def update_trip(trip_id: PositiveId, changes: TripChanges) -> dict[str, Any]:
    """Change specified trip properties. Use null to clear dates. Existing expenses lock the base currency."""
    with store.session(True) as con:
        return store.edit_trip(con, trip_id, changes.model_dump(exclude_unset=True))


def create_stop(trip_id: PositiveId, stop: models.Stop) -> dict[str, Any]:
    """Append a stop to a trip. Use saved for the wishlist, kind=sleep for lodging and omit date for a
    flexible stop. stage_id without variant_id is common to all variants. A variant needs its stage_id."""
    with store.session(True) as con:
        return store.upsert(con, trip_id, "stops", stop.model_dump())


def update_stop(trip_id: PositiveId, stop_id: PositiveId, changes: StopChanges) -> dict[str, Any]:
    """Edit just the given stop fields. Set done=true when visited, saved=false to plan a saved place,
    date=null for a flexible stop or variant_id=null for a common stop within the stage."""
    with store.session(True) as con:
        return store.upsert(con, trip_id, "stops", changes.model_dump(exclude_unset=True), stop_id)


def delete_stop(trip_id: PositiveId, stop_id: PositiveId) -> dict[str, Any]:
    """Permanently remove a stop and detach its journal, favorite and transport links."""
    with store.session(True) as con:
        store.remove(con, trip_id, "stops", stop_id)
    return {"deleted_stop_id": stop_id}


def reorder_stops(trip_id: PositiveId, stop_ids: list[PositiveId]) -> dict[str, Any]:
    """Submit all stop IDs from the stops section once, including inactive variants and wishlist places.
    Saved places remain after route stops. Use reorder_stages to change the order of whole stages."""
    from .app import order_stops
    saved = order_stops(trip_id, models.Order(ids=stop_ids))
    return {"trip_id": trip_id, "stop_ids": [s["id"] for s in saved]}


def create_stage(trip_id: PositiveId, name: models.Name, notes: models.Note = "") -> dict[str, Any]:
    """Append a named stage to a trip. Assign new or existing stops to its returned ID."""
    return stages.create_stage(trip_id, stages.Description(name=name, notes=notes))


def update_stage(trip_id: PositiveId, stage_id: PositiveId, changes: DescriptionChanges) -> dict[str, Any]:
    """Change a stage name or notes, retaining fields you omit."""
    return stages.edit_stage(trip_id, stage_id, changes.model_dump(exclude_unset=True))


def reorder_stages(trip_id: PositiveId, stage_ids: list[PositiveId]) -> dict[str, Any]:
    """Set travel order using every stage ID of this trip exactly once."""
    result = stages.order_stages(trip_id, models.Order(ids=stage_ids))
    return {"trip_id": trip_id, "stage_ids": [s["id"] for s in result]}


def create_variant(trip_id: PositiveId, stage_id: PositiveId, name: models.Name, notes: models.Note = "") -> dict[str, Any]:
    """Add an alternative route within a stage. Its first variant becomes active automatically."""
    return stages.create_variant(trip_id, stage_id, stages.Description(name=name, notes=notes))


def update_variant(trip_id: PositiveId, stage_id: PositiveId, variant_id: PositiveId, changes: DescriptionChanges) -> dict[str, Any]:
    """Change the name or notes of one alternative route."""
    return stages.edit_variant(trip_id, stage_id, variant_id, changes.model_dump(exclude_unset=True))


def activate_variant(trip_id: PositiveId, stage_id: PositiveId, variant_id: PositiveId) -> dict[str, Any]:
    """Switch the active route for this stage. Other variants retain all their stops and notes."""
    return stages.activate_variant(trip_id, stage_id, variant_id)


def delete_stage(trip_id: PositiveId, stage_id: PositiveId) -> dict[str, Any]:
    """Remove a stage and its variants. Active stops become unassigned, unused alternatives become saved places."""
    stages.delete_stage(trip_id, stage_id)
    return {"deleted_stage_id": stage_id}


def delete_variant(trip_id: PositiveId, stage_id: PositiveId, variant_id: PositiveId) -> dict[str, Any]:
    """Remove a variant. Its active stops become common stage stops; its inactive stops enter the wishlist."""
    stages.delete_variant(trip_id, stage_id, variant_id)
    return {"deleted_variant_id": variant_id}


def register_planning_tools(server, read_only=False):
    for function in (list_trips, get_trip, read_trip_section):
        domain_tool(server, READ)(function)
    if not read_only:
        for function in (create_trip, create_stop, create_stage, create_variant):
            domain_tool(server, CREATE)(function)
        for function in (update_trip, update_stop, reorder_stops, update_stage, reorder_stages,
                         update_variant, activate_variant):
            domain_tool(server, EDIT)(function)
        for function in (delete_stop, delete_stage, delete_variant):
            domain_tool(server, EDIT)(function)
