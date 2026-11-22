"""MCP tools for the trip's ledger, supplies, diary and reusable places."""

from typing import Annotated, Any, Literal

from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from . import journal, models, store
from .mcp_tools import EDIT, READ, Limit, Offset, PositiveId, domain_tool, partial_fields


PurchaseFields = partial_fields(models.Purchase)
MobilityFields = partial_fields(models.Mobility)
ExpenseFields = partial_fields(models.Expense)
PantryFields = partial_fields(models.Pantry)
ShoppingFields = partial_fields(models.Shopping)
JournalFields = partial_fields(journal.JournalEntry)
RecordGroup = Literal["purchases", "mobility", "expenses", "pantry", "shopping", "journal"]

SAVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False)
COPY = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def save_record(trip_id, group, fields, record_id):
    with store.session(True) as con:
        return store.upsert(con, trip_id, group, fields.model_dump(exclude_unset=True), record_id)


def register_management_tools(server, read_only=False):
    @domain_tool(server, READ)
    def read_journal_entry(
        trip_id: PositiveId, entry_id: PositiveId, text_offset: Offset = 0,
        text_limit: Annotated[int, Field(ge=1, le=16000)] = 8000,
        media_offset: Offset = 0, media_limit: Limit = 20,
    ) -> dict[str, Any]:
        """Lies einen Tagebucheintrag mit Orts-IDs und Medienmetadaten.

        Folge den next_*_offset-Werten für weitere Textzeichen oder Anhänge.
        """
        with store.session() as con:
            entry = journal.get_entry(con, trip_id, entry_id)
        text_end, media_end = text_offset + text_limit, media_offset + media_limit
        return {
            **entry, "text": entry["text"][text_offset:text_end], "media": entry["media"][media_offset:media_end],
            "text_length": len(entry["text"]), "media_count": len(entry["media"]),
            "next_text_offset": text_end if text_end < len(entry["text"]) else None,
            "next_media_offset": media_end if media_end < len(entry["media"]) else None,
        }

    @domain_tool(server, READ)
    def list_favorites(query: models.Short = "", offset: Offset = 0, limit: Limit = 20) -> dict[str, Any]:
        """Finde Lieblingsplätze aller Reisen nach Reise, Ortsname oder Adresse.

        Mit der stop_id kannst du den Ort über copy_favorite in eine andere Reise übernehmen.
        """
        search = query.casefold()
        matches = []
        for favorite in journal.list_favorites():
            stop = favorite["stop"]
            if any(search in name.casefold() for name in (favorite["trip_name"], stop["title"], stop["address"])):
                matches.append({
                    "trip_id": favorite["trip_id"], "trip_name": favorite["trip_name"],
                    "stop_id": stop["id"], "title": stop["title"], "kind": stop["kind"], "address": stop["address"],
                    "lat": stop["lat"], "lon": stop["lon"], "copied_to_trip_ids": favorite["copied_to_trip_ids"],
                })
        end = offset + limit
        return {"items": matches[offset:end], "total": len(matches), "next_offset": end if end < len(matches) else None}

    if read_only:
        return

    @domain_tool(server, SAVE)
    def save_purchase(trip_id: PositiveId, fields: PurchaseFields, record_id: PositiveId | None = None) -> dict[str, Any]:
        """Plane eine Anschaffung mit title oder ändere einzelne Felder per record_id.

        estimated_cost ist der Gesamtpreis. paid bestätigt die Zahlung, done den Kauf.
        Der Finanzposten wird automatisch aktualisiert. Bei Fremdwährung gilt
        1 Originalwährung = exchange_rate Einheiten der Basiswährung.
        """
        return save_record(trip_id, "purchases", fields, record_id)

    @domain_tool(server, SAVE)
    def save_mobility(trip_id: PositiveId, fields: MobilityFields, record_id: PositiveId | None = None) -> dict[str, Any]:
        """Plane eine Fahrt oder erfasse einen Tankstopp mit title. Ändere einzelne Felder per record_id.

        Für fuel ist quantity in Litern und odometer der Kilometerstand. estimated_cost ist der
        Gesamtbetrag, paid die Zahlung und done die Durchführung. Der Finanzposten folgt automatisch.
        """
        return save_record(trip_id, "mobility", fields, record_id)

    @domain_tool(server, SAVE)
    def save_expense(trip_id: PositiveId, fields: ExpenseFields, record_id: PositiveId | None = None) -> dict[str, Any]:
        """Erfasse eine freie Ausgabe mit title und amount oder ändere einen Finanzposten per record_id.

        Nutze status=planned für eine Schätzung und paid für eine Zahlung. exchange_rate gibt den
        Basiswährungswert einer Einheit Originalwährung an. Bei Anschaffungen und Fahrten die
        bestehende expense_id als record_id verwenden.
        """
        return save_record(trip_id, "expenses", fields, record_id)

    @domain_tool(server, SAVE)
    def save_pantry_item(trip_id: PositiveId, fields: PantryFields, record_id: PositiveId | None = None) -> dict[str, Any]:
        """Buche Vorrat mit name, quantity und unit ein.

        Bei gleichem Namen und gleicher Einheit addiert die Anlage die Menge zum Bestand. Mit
        record_id ist quantity der neue absolute Bestand. Für Verbrauch gibt es consume_pantry.
        """
        return save_record(trip_id, "pantry", fields, record_id)

    @domain_tool(server, SAVE)
    def save_shopping_item(trip_id: PositiveId, fields: ShoppingFields, record_id: PositiveId | None = None) -> dict[str, Any]:
        """Setze einen Artikel mit name, quantity und unit auf die Einkaufsliste oder korrigiere ihn per record_id.

        Zum tatsächlichen Einkauf checkout_shopping mit den gekauften Teilmengen und dem Bonbetrag verwenden.
        """
        return save_record(trip_id, "shopping", fields, record_id)

    @domain_tool(server, EDIT)
    def checkout_shopping(trip_id: PositiveId, receipt: models.Checkout) -> dict[str, Any]:
        """Schließe einen Einkauf ab. items enthält Einkaufslisten-IDs und gekaufte Mengen. amount ist der Bonbetrag.

        Der Vorgang bucht Vorrat, Restbedarf und eine Zahlung zusammen. Pro Bon eine eindeutige
        request_id vergeben und beim Wiederholen mit denselben Daten erneut verwenden.
        """
        with store.session(True) as con:
            return store.checkout(con, trip_id, receipt)

    @domain_tool(server, SAVE)
    def consume_pantry(trip_id: PositiveId, record_id: PositiveId, quantity: models.PositiveQuantity) -> dict[str, Any]:
        """Buche die verbrauchte Menge eines Vorratsartikels in seiner vorhandenen Einheit ab."""
        from .app import consume
        return consume(trip_id, record_id, models.Consume(quantity=quantity))

    @domain_tool(server, SAVE)
    def save_journal_entry(trip_id: PositiveId, fields: JournalFields, entry_id: PositiveId | None = None) -> dict[str, Any]:
        """Lege einen Tagebucheintrag mit date (JJJJ-MM-TT) und title, text oder stop_ids an.

        Mit entry_id werden die übergebenen Felder geändert. stop_ids ersetzt die Ortsverknüpfungen.
        Gibt ID und Datum zurück.
        """
        values = fields.model_dump(exclude_unset=True)
        if entry_id is None:
            note = journal.JournalEntry.model_validate(values)
            if not (note.title or note.text or note.stop_ids):
                raise ToolError("Der Tagebucheintrag benötigt einen Titel, Text oder einen verknüpften Ort.")
            entry = journal.add_entry(trip_id, note)
        else:
            entry = journal.edit_entry(trip_id, entry_id, values)
        return {"id": entry["id"], "trip_id": trip_id, "date": entry["date"]}

    @domain_tool(server, EDIT)
    def set_favorite(trip_id: PositiveId, stop_id: PositiveId, favorite: bool = True) -> dict[str, Any]:
        """Merke einen Ort als reiseübergreifenden Lieblingsplatz. favorite=false entfernt die Markierung."""
        if favorite:
            journal.add_favorite(trip_id, stop_id)
        else:
            journal.remove_favorite(trip_id, stop_id)
        return {"trip_id": trip_id, "stop_id": stop_id, "favorite": favorite}

    @domain_tool(server, COPY)
    def copy_favorite(trip_id: PositiveId, stop_id: PositiveId) -> dict[str, Any]:
        """Übernimm einen Lieblingsplatz aus list_favorites in die Merkliste der Zielreise trip_id.

        Wiederholungen für dieselbe stop_id und Zielreise liefern denselben Ort zurück.
        """
        return journal.copy_favorite(trip_id, stop_id)

    @domain_tool(server, SAVE)
    def delete_record(trip_id: PositiveId, collection: RecordGroup, record_id: PositiveId) -> dict[str, Any]:
        """Lösche den genannten Eintrag endgültig.

        Bei einer Anschaffung oder Fahrt entfällt auch ihr Finanzposten. Bei einem Tagebucheintrag
        werden dessen Fotos und Videos mitgelöscht.
        """
        if collection == "journal":
            journal.delete_entry(trip_id, record_id)
        else:
            with store.session(True) as con:
                store.remove(con, trip_id, collection, record_id)
        return {"deleted_id": record_id, "collection": collection}
