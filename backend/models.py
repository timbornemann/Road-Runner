"""Validation at the HTTP boundary. Quantities use up to three decimal places."""

import datetime as dt
import unicodedata
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=250)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=16000)]
Currency = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")]
Money = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
Quantity = Annotated[Decimal, Field(ge=0, max_digits=13, decimal_places=3)]
PositiveQuantity = Annotated[Decimal, Field(gt=0, max_digits=13, decimal_places=3)]
Rate = Annotated[Decimal, Field(gt=0, le=1000000, decimal_places=10)]


def unique_tags(tags: list[str]) -> list[str]:
    """Keep the spelling and order of the first non-empty occurrence."""
    seen = set()
    result = []
    for value in tags:
        tag = value.strip()
        key = unicodedata.normalize("NFC", tag).casefold()
        if tag and key not in seen:
            seen.add(key)
            result.append(tag)
    return result


def validation_message(errors):
    labels = {
        "name": "Name", "title": "Bezeichnung", "start_date": "Reisebeginn", "end_date": "Enddatum",
        "date": "Datum", "time": "Uhrzeit", "currency": "Währung", "exchange_rate": "Wechselkurs",
        "amount": "Betrag", "estimated_cost": "Kosten", "budget": "Budget", "quantity": "Menge",
        "odometer": "Kilometerstand", "unit": "Einheit", "notes": "Notizen", "kind": "Art",
        "departure": "Abfahrt", "arrival": "Ankunft", "lat": "Breitengrad", "lon": "Längengrad",
        "category": "Kategorie", "status": "Zahlungsstatus", "request_id": "Buchungsnummer",
        "items": "Einkaufspositionen", "region": "Region", "description": "Beschreibung",
        "address": "Adresse", "origin": "Start", "destination": "Ziel", "tags": "Tags",
    }
    messages = []
    for error in errors:
        field = next((labels[part] for part in reversed(error["loc"]) if part in labels), "Eingabe")
        kind, context = error["type"], error.get("ctx", {})
        if kind == "value_error":
            messages.append(error["msg"].removeprefix("Value error, "))
        elif kind == "decimal_max_places":
            messages.append(f"{field} darf höchstens {context['decimal_places']} Nachkommastellen haben.")
        elif kind in ("greater_than", "greater_than_equal", "less_than_equal"):
            checks = {"greater_than": ("größer als", "gt"), "greater_than_equal": ("mindestens", "ge"),
                      "less_than_equal": ("höchstens", "le")}
            word, key = checks[kind]
            messages.append(f"{field} muss {word} {context[key]} sein.")
        elif kind in ("missing", "string_too_short", "too_short"):
            messages.append(f"Bitte das Feld „{field}“ ausfüllen.")
        else:
            messages.append(f"Bitte überprüfe das Feld „{field}“.")
    return " ".join(dict.fromkeys(messages))


class Form(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class TaggedForm(Form):
    tags: Annotated[list[str], AfterValidator(unique_tags)] = Field(default_factory=list)


class Trip(Form):
    name: Name
    region: Short = ""
    description: Note = ""
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    budget: Money = Decimal(0)
    currency: Currency = "EUR"

    @model_validator(mode="after")
    def valid_period(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("Das Reiseende muss am oder nach dem Reisebeginn liegen.")
        return self


class Stop(TaggedForm):
    title: Name
    stage_id: int | None = None
    variant_id: int | None = None
    kind: Literal["stop", "sight", "sleep"] = "stop"
    date: dt.date | None = None
    time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    end_date: dt.date | None = None
    address: Short = ""
    lat: Annotated[float, Field(ge=-90, le=90)] | None = None
    lon: Annotated[float, Field(ge=-180, le=180)] | None = None
    notes: Note = ""
    position: Annotated[int, Field(ge=0)] = 0
    saved: bool = False
    done: bool = False

    @model_validator(mode="after")
    def consistent(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Breiten- und Längengrad bitte zusammen angeben.")
        if self.end_date and self.date and self.end_date < self.date:
            raise ValueError("Die Abreise muss am oder nach der Anreise liegen.")
        return self


class Costed(TaggedForm):
    title: Name
    date: dt.date | None = None
    estimated_cost: Money = Decimal(0)
    currency: Currency
    exchange_rate: Rate = Decimal(1)
    paid: bool = False
    notes: Note = ""
    done: bool = False


class Purchase(Costed):
    quantity: PositiveQuantity = Decimal(1)
    unit: Short = "Stk."


class Mobility(Costed):
    kind: Literal["fuel", "ferry", "train", "parking", "toll", "other"] = "other"
    stop_id: int | None = None
    quantity: PositiveQuantity | None = None
    odometer: Quantity | None = None
    origin: Short = ""
    destination: Short = ""
    departure: dt.datetime | None = None
    arrival: dt.datetime | None = None

    @model_validator(mode="after")
    def valid_times(self):
        if self.departure and self.arrival:
            if (self.departure.tzinfo is None) != (self.arrival.tzinfo is None):
                raise ValueError("Die Zeitangaben müssen dieselbe Art von Zeitzone verwenden.")
            if self.arrival < self.departure:
                raise ValueError("Die Ankunft muss nach der Abfahrt liegen.")
        return self


class Pantry(TaggedForm):
    name: Name
    quantity: Quantity = Decimal(1)
    unit: Short = "Stk."


class Shopping(Pantry):
    done: bool = False


class Expense(TaggedForm):
    title: Name
    amount: PositiveMoney
    currency: Currency
    exchange_rate: Rate = Decimal(1)
    date: dt.date = Field(default_factory=dt.date.today)
    category: Name = "other"
    status: Literal["paid", "planned"] = "paid"
    notes: Note = ""


class Pick(Form):
    id: int
    quantity: PositiveQuantity


class Checkout(Form):
    items: Annotated[list[Pick], Field(min_length=1, max_length=1000)]
    request_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
    amount: PositiveMoney
    currency: Currency | None = None
    exchange_rate: Rate | None = None
    date: dt.date = Field(default_factory=dt.date.today)
    title: Name = "Lebensmitteleinkauf"


class Consume(Form):
    quantity: PositiveQuantity


class Order(Form):
    ids: list[int]
