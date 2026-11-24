"""SQLite persistence. Every write workflow uses one IMMEDIATE transaction."""

import datetime as dt
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from . import models
from . import stages


COLLECTIONS = {
    "stops": models.Stop, "purchases": models.Purchase, "shopping": models.Shopping,
    "pantry": models.Pantry, "mobility": models.Mobility, "expenses": models.Expense,
}
COSTED = {"purchases", "mobility"}
MONEY_FIELDS = {"budget", "estimated_cost", "amount", "base_amount"}
SCHEMA_VERSION = 4


def data_file():
    return Path(os.getenv("RR_DATA_DIR", "data")) / "road-runner.sqlite3"


def connect(*, check_same_thread=True):
    con = sqlite3.connect(data_file(), timeout=15, isolation_level=None, check_same_thread=check_same_thread)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextmanager
def session(write=False):
    con = connect()
    try:
        con.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


def initialize():
    data_file().parent.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as con:
        con.execute("PRAGMA journal_mode=WAL")
    with session(True) as con:
        version = con.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError("Die Datenbank benötigt eine neuere Road-Runner-Version.")
        if version == 0:
            con.execute("CREATE TABLE trips (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)")
            con.execute("""CREATE TABLE records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                collection TEXT NOT NULL, data TEXT NOT NULL)""")
            con.execute("CREATE INDEX records_trip_collection ON records(trip_id,collection)")
            con.execute("""CREATE TABLE checkouts (
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
                PRIMARY KEY (trip_id, request_id))""")
        elif version == 1:
            migrate_v1(con)
        if version < 3:
            from . import journal
            journal.migrate(con)
            stages.migrate(con)
        if version < 4:
            from . import notebook_schema
            notebook_schema.migrate(con)
        if version == 0:
            from .seed import seed_demo
            seed_demo(con)
        if version < SCHEMA_VERSION:
            con.execute(f"PRAGMA user_version={SCHEMA_VERSION}")


def migrate_v1(con):
    # v1 had no tags. Preserve all original amounts (integer cents), linked IDs and receipt snapshots.
    con.execute("UPDATE records SET data=json_insert(data, '$.tags', json('[]'))")
    con.execute("UPDATE checkouts SET result=json_insert(result, '$.tags', json('[]'))")
    for row in con.execute("SELECT id FROM trips"):
        # records() already orders by position and id. The former UI grouped route stops by date,
        # put undated stops last and displayed saved places separately in their original order.
        stops = records(con, row["id"], "stops")
        stops.sort(key=lambda s: (s["saved"], "" if s["saved"] else (s["date"] or "9999")))
        write_stop_order(con, stops)


def dec(value):
    return Decimal(str(value))


def cents(value):
    return int((dec(value) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def encoded(data):
    result = {key: value for key, value in data.items() if key not in ("id", "trip_id")}
    for key in MONEY_FIELDS.intersection(result):
        result[key] = cents(result[key])
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def unpack(row):
    result = json.loads(row["data"])
    for key in MONEY_FIELDS.intersection(result):
        result[key] = result[key] / 100
    result["id"] = row["id"]
    if "trip_id" in row.keys():
        result["trip_id"] = row["trip_id"]
    return result


def simple(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return value


def validated(model, changes, previous=None):
    values = {k: v for k, v in (previous or {}).items() if k in model.model_fields}
    try:
        parsed = model.model_validate({**values, **changes})
    except ValidationError as err:
        raise HTTPException(422, models.validation_message(err.errors())) from err
    return {k: simple(v) for k, v in parsed.model_dump().items()}


def trips(con):
    return [unpack(r) for r in con.execute("SELECT * FROM trips ORDER BY id")]


def trip(con, tid):
    row = con.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone()
    if not row:
        raise HTTPException(404, "Reise nicht gefunden.")
    return unpack(row)


def create_trip(con, values, demo=False):
    data = validated(models.Trip, values)
    data["is_demo"] = demo
    tid = con.execute("INSERT INTO trips(data) VALUES(?)", (encoded(data),)).lastrowid
    return trip(con, tid)


def edit_trip(con, tid, values):
    original = trip(con, tid)
    result = validated(models.Trip, values, original)
    if result["currency"] != original["currency"]:
        if records(con, tid, "expenses"):
            raise HTTPException(409, "Eine Reise mit Buchungen behält ihre Basiswährung.")
        for group in COSTED:
            for entry in records(con, tid, group):
                if entry["currency"] == original["currency"]:
                    put(con, tid, group, {**entry, "currency": result["currency"], "exchange_rate": 1})
    result["is_demo"] = original["is_demo"]
    con.execute("UPDATE trips SET data=? WHERE id=?", (encoded(result), tid))
    return trip(con, tid)


def records(con, tid, group):
    rows = con.execute("SELECT * FROM records WHERE trip_id=? AND collection=? ORDER BY id", (tid, group))
    entries = [unpack(r) for r in rows]
    if group == "stops":
        entries.sort(key=lambda s: (s["position"], s["id"]))
    return entries


def write_stop_order(con, stops):
    for position, stop in enumerate(stops):
        if stop["position"] != position:
            con.execute("UPDATE records SET data=json_set(data, '$.position', ?) WHERE id=?",
                        (position, stop["id"]))


def record(con, tid, group, rid):
    row = con.execute("SELECT * FROM records WHERE trip_id=? AND collection=? AND id=?", (tid, group, rid)).fetchone()
    if not row:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return unpack(row)


def aggregate(con, tid):
    from . import journal, notebook
    return {"trip": trip(con, tid), **journal.trip_data(con, tid), **{group: records(con, tid, group) for group in COLLECTIONS},
            "stages": stages.stage_data(con, tid), "notebook": notebook.trip_data(con, tid)}


def put(con, tid, group, data):
    rid = data.get("id")
    if rid is None:
        rid = con.execute("INSERT INTO records(trip_id,collection,data) VALUES(?,?,?)",
                          (tid, group, encoded(data))).lastrowid
    else:
        con.execute("UPDATE records SET data=? WHERE trip_id=? AND collection=? AND id=?",
                    (encoded(data), tid, group, rid))
    return record(con, tid, group, rid)


def prepare_currency(values, original, base):
    data = dict(values)
    currency = str(data.get("currency", original.get("currency", base))).upper().strip()
    data["currency"] = currency
    if currency == base:
        data["exchange_rate"] = 1
    elif "exchange_rate" not in data and currency != original.get("currency"):
        raise HTTPException(422, "Für eine Fremdwährung ist ein Wechselkurs erforderlich.")
    return data


def with_base(expense):
    value = cents(dec(expense["amount"]) * dec(expense["exchange_rate"]))
    if value > 99_999_999_999_999:
        raise HTTPException(422, "Der Gegenwert ist zu hoch.")
    return {**expense, "base_amount": value / 100}


def inventory_key(item):
    return (item["name"].strip().casefold(), item["unit"].strip().casefold())


def upsert(con, tid, group, values, rid=None):
    if group not in COLLECTIONS:
        raise HTTPException(404, "Bereich nicht gefunden.")
    journey = trip(con, tid)
    original = record(con, tid, group, rid) if rid is not None else {}
    if group in COSTED or group == "expenses":
        values = prepare_currency(values, original, journey["currency"])
    data = validated(COLLECTIONS[group], values, original)
    if group == "stops":
        stages.validate_stop(con, tid, data)
    if group == "mobility" and data["stop_id"] is not None:
        record(con, tid, "stops", data["stop_id"])
    if group == "shopping":
        data["manual"] = True
        data["expense_id"] = original.get("expense_id")
        if data["quantity"] <= 0:
            data["done"] = True
    if group == "pantry":
        for entry in records(con, tid, "pantry"):
            if entry["id"] != rid and inventory_key(entry) == inventory_key(data):
                if rid is not None:
                    raise HTTPException(409, "Dieser Vorrat existiert mit derselben Einheit bereits.")
                return put(con, tid, group, {
                    **entry, "quantity": added_quantity(entry["quantity"], data["quantity"]),
                    "tags": models.unique_tags(entry["tags"] + data["tags"]),
                })
    if group == "expenses":
        data = with_base(data)
        for key in ("source_type", "source_id"):
            data[key] = original.get(key)
        data["items"] = original.get("items", [])
        if data["source_type"] == "shopping" and data["status"] != "paid":
            raise HTTPException(409, "Ein abgeschlossener Einkauf ist bereits bezahlt.")
    if group in COSTED:
        data["expense_id"] = original.get("expense_id")
        if not data["estimated_cost"]:
            data["paid"] = False
    saved = put(con, tid, group, {**data, "id": rid})
    if group == "stops":
        added_to_group = not original or saved["saved"] != original["saved"]
        if added_to_group or saved["position"] != original["position"]:
            stops = [s for s in records(con, tid, "stops") if s["id"] != saved["id"]]
            position = len(stops) if added_to_group else min(saved["position"], len(stops))
            stops.insert(position, saved)
            stops.sort(key=lambda s: s["saved"])
            write_stop_order(con, stops)
            return record(con, tid, group, saved["id"])
    if group in COSTED:
        return sync_cost(con, tid, group, saved, original)
    if group == "expenses" and saved["source_type"] in COSTED:
        source = record(con, tid, saved["source_type"], saved["source_id"])
        put(con, tid, saved["source_type"], {
            **source, "title": saved["title"], "estimated_cost": saved["amount"], "notes": saved["notes"],
            "tags": saved["tags"],
            "currency": saved["currency"], "exchange_rate": saved["exchange_rate"],
            "paid": saved["status"] == "paid", "date": source["date"] if saved["source_type"] == "mobility" else saved["date"],
        })
    return saved


def sync_cost(con, tid, group, source, original):
    eid = source["expense_id"]
    if source["estimated_cost"] <= 0:
        if eid:
            con.execute("DELETE FROM records WHERE trip_id=? AND id=?", (tid, eid))
            return put(con, tid, group, {**source, "expense_id": None})
        return source
    previous = record(con, tid, "expenses", eid) if eid else {}
    date = source["date"] or previous.get("date") or dt.date.today().isoformat()
    if group == "mobility" and previous:
        if source["paid"] and not original["paid"]:
            date = dt.date.today().isoformat()
        elif previous["status"] == "paid" or source["date"] == original["date"]:
            date = previous["date"]
    expense = with_base({
        "title": source["title"], "amount": source["estimated_cost"], "currency": source["currency"],
        "exchange_rate": source["exchange_rate"], "date": date,
        "category": previous.get("category", "purchase" if group == "purchases" else "mobility"),
        "status": "paid" if source["paid"] else "planned", "notes": source["notes"],
        "source_type": group, "source_id": source["id"], "id": eid, "items": [], "tags": source["tags"],
    })
    saved = put(con, tid, "expenses", expense)
    if eid is None:
        return put(con, tid, group, {**source, "expense_id": saved["id"]})
    return source


def remove(con, tid, group, rid):
    if group not in COLLECTIONS:
        raise HTTPException(404, "Bereich nicht gefunden.")
    original = record(con, tid, group, rid)
    if group in COSTED and original["expense_id"]:
        con.execute("DELETE FROM records WHERE trip_id=? AND id=?", (tid, original["expense_id"]))
    if group == "expenses" and original["source_type"] in COSTED:
        source = record(con, tid, original["source_type"], original["source_id"])
        put(con, tid, original["source_type"], {**source, "expense_id": None, "estimated_cost": 0, "paid": False})
    if group == "expenses" and original["source_type"] == "shopping":
        for line in records(con, tid, "shopping"):
            if line["expense_id"] == rid:
                put(con, tid, "shopping", {**line, "expense_id": None})
    if group == "stops":
        for ride in records(con, tid, "mobility"):
            if ride["stop_id"] == rid:
                put(con, tid, "mobility", {**ride, "stop_id": None})
    con.execute("DELETE FROM records WHERE trip_id=? AND collection=? AND id=?", (tid, group, rid))


def added_quantity(first, second):
    total = dec(first) + dec(second)
    if total > Decimal("9999999999.999"):
        raise HTTPException(422, "Die Gesamtmenge ist zu groß.")
    return float(total)


def checkout(con, tid, payload):
    journey = trip(con, tid)
    # The original client request defines identity, independent of defaults such as today's date.
    fingerprint = json.dumps(payload.model_dump(mode="json", exclude_unset=True), sort_keys=True, separators=(",", ":"))
    existing = con.execute("SELECT * FROM checkouts WHERE trip_id=? AND request_id=?", (tid, payload.request_id)).fetchone()
    if existing:
        if existing["fingerprint"] != fingerprint:
            raise HTTPException(409, "Diese Buchungsnummer gehört zu einem anderen Einkauf.")
        return json.loads(existing["result"])
    picks = payload.items
    if len({pick.id for pick in picks}) != len(picks):
        raise HTTPException(422, "Eine Einkaufsposition kommt mehrfach vor.")
    lines = []
    for pick in picks:
        item = record(con, tid, "shopping", pick.id)
        if item["done"] or pick.quantity > dec(item["quantity"]):
            raise HTTPException(409, "Die Einkaufsmenge übersteigt den offenen Bedarf.")
        lines.append((item, pick.quantity))
    fields = {"title": payload.title, "amount": payload.amount, "date": payload.date,
              "category": "food", "currency": payload.currency or journey["currency"],
              "tags": [tag for item, _ in lines for tag in item["tags"]]}
    if payload.exchange_rate is not None:
        fields["exchange_rate"] = payload.exchange_rate
    expense = upsert(con, tid, "expenses", fields)
    details = []
    for item, quantity in lines:
        rest = float(dec(item["quantity"]) - quantity)
        put(con, tid, "shopping", {**item, "quantity": rest, "done": rest == 0, "expense_id": expense["id"]})
        upsert(con, tid, "pantry", {"name": item["name"], "quantity": quantity, "unit": item["unit"], "tags": item["tags"]})
        details.append({"id": item["id"], "name": item["name"], "quantity": float(quantity), "unit": item["unit"]})
    expense = put(con, tid, "expenses", {**expense, "source_type": "shopping", "items": details})
    con.execute("INSERT INTO checkouts(trip_id,request_id,fingerprint,result) VALUES(?,?,?,?)",
                (tid, payload.request_id, fingerprint, json.dumps(expense)))
    return expense
