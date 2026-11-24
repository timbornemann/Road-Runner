"""MCP tools for a trip's local place collection and repeatable itinerary visits."""

import datetime as dt
from typing import Annotated, Any

from pydantic import Field

from . import models, places, store
from .mcp_tools import CREATE, EDIT, READ, Limit, Offset, PositiveId, _page, domain_tool, partial_fields

PlaceChanges = partial_fields(places.Place)


class VisitChanges(models.Form):
    stage_id: PositiveId | None = None
    variant_id: PositiveId | None = None
    date: dt.date | None = None
    time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    end_date: dt.date | None = None
    done: bool | None = None
    position: Annotated[int, Field(ge=0)] | None = None
    kind: places.Kind | None = None


def register_place_tools(server, read_only=False):
    @domain_tool(server, READ)
    def search_places(trip_id: PositiveId, query: models.Short = "", category: models.Short = "",
                      planned: bool | None = None, offset: Offset = 0, limit: Limit = 20) -> dict[str, Any]:
        """Durchsuche die lokal gespeicherten Orte dieser Reise nach Name, Adresse, Beschreibung und Tags.
        planned berücksichtigt auch vorbereitete Varianten. Die Suche fragt keine externen Dienste an."""
        with store.session() as con:
            store.trip(con, trip_id)
            used = {s["place_id"] for s in store.records(con, trip_id, "stops") if not s["saved"]}
            matches = []
            for p in places.place_rows(con, trip_id):
                is_planned = p["id"] in used
                if planned is not None and is_planned != planned:
                    continue
                if category and p["category"].casefold() != category.strip().casefold():
                    continue
                words = [p["title"], p["address"], p["category"], p["description"], *p["tags"]]
                if query.strip().casefold() in " ".join(words).casefold():
                    matches.append({key: p[key] for key in ("id", "title", "category", "address", "lat", "lon")}
                                   | {"planned": is_planned})
        return _page(matches[offset:offset + limit], len(matches), offset, limit)

    @domain_tool(server, READ)
    def read_place(trip_id: PositiveId, place_id: PositiveId) -> dict[str, Any]:
        """Lies Beschreibung, Symbol, Bildmetadaten und Weblinks. Zugehörige Besuche liefert list_visits."""
        return places.get_place(trip_id, place_id)

    @domain_tool(server, READ)
    def list_visits(trip_id: PositiveId, place_id: PositiveId | None = None, offset: Offset = 0,
                    limit: Limit = 20) -> dict[str, Any]:
        """Lies Besuche mit eigener ID, Orts-ID, Termin und Etappe, einschließlich inaktiver Varianten."""
        with store.session() as con:
            store.trip(con, trip_id)
            if place_id is not None:
                places.place_row(con, trip_id, place_id)
            rows = [places.visit(s) | {"title": s["title"]} for s in store.records(con, trip_id, "stops")
                    if not s["saved"] and (place_id is None or s["place_id"] == place_id)]
        return _page(rows[offset:offset + limit], len(rows), offset, limit)

    if read_only:
        return

    @domain_tool(server, CREATE)
    def create_place(trip_id: PositiveId, place: places.Place) -> dict[str, Any]:
        """Speichere einen Ort auf der Ortekarte. Ein vorhandenes OSM-Objekt liefert denselben Ort."""
        return places.create_place(trip_id, place)

    @domain_tool(server, EDIT)
    def update_place(trip_id: PositiveId, place_id: PositiveId, changes: PlaceChanges) -> dict[str, Any]:
        """Ändere gemeinsame Ortsdetails für alle Besuche. Sende nur die gewünschten Felder."""
        return places.edit_place(trip_id, place_id, changes.model_dump(mode="json", exclude_unset=True))

    @domain_tool(server, CREATE)
    def create_visit(trip_id: PositiveId, visit: places.VisitCreate) -> dict[str, Any]:
        """Plane einen Besuch eines vorhandenen Ortes (place_id) oder erstelle Ort und Besuch zusammen (place).
        Auch für Hin- und Rückweg desselben Ortes möglich. Jeder Besuch hat eigenen Termin und Status."""
        return places.create_visit(trip_id, visit)

    @domain_tool(server, EDIT)
    def update_visit(trip_id: PositiveId, visit_id: PositiveId, changes: VisitChanges) -> dict[str, Any]:
        """Ändere Termin, Reihenfolge, Variante oder Besuchsstatus dieses einzelnen Besuchs."""
        return places.edit_visit(trip_id, visit_id, changes.model_dump(mode="json", exclude_unset=True))

    @domain_tool(server, EDIT)
    def remove_visit(trip_id: PositiveId, visit_id: PositiveId) -> dict[str, Any]:
        """Entferne einen Besuch aus der Route. Sein Ort bleibt in der Sammlung."""
        places.delete_visit(trip_id, visit_id)
        return {"removed_visit_id": visit_id}

    @domain_tool(server, EDIT)
    def reorder_visits(trip_id: PositiveId, visit_ids: list[PositiveId]) -> dict[str, Any]:
        """Ordne alle Besuche dieser Reise, einschließlich alternativer Varianten, mit ihren Besuchs-IDs."""
        rows = places.order_visits(trip_id, models.Order(ids=visit_ids))
        return {"visit_ids": [s["id"] for s in rows]}

    @domain_tool(server, EDIT)
    def delete_place(trip_id: PositiveId, place_id: PositiveId) -> dict[str, Any]:
        """Lösche einen Ort aus der Sammlung. Eingeplante Besuche vorher einzeln entfernen."""
        places.delete_place(trip_id, place_id)
        return {"deleted_place_id": place_id}
