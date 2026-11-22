import datetime as dt

from . import models, store


def seed_demo(con):
    """Called exactly once by the initial schema migration."""
    start = dt.date.today() - dt.timedelta(days=2)

    def day(offset):
        return (start + dt.timedelta(days=offset)).isoformat()

    journey = store.create_trip(con, {
        "name": "Dolomiten-Roadtrip", "region": "Südtirol, Italien", "description": "Neun Tage zwischen Bergseen, Passstraßen und den Drei Zinnen.",
        "start_date": day(0), "end_date": day(8), "budget": 1800, "currency": "EUR",
    }, demo=True)
    tid = journey["id"]

    def add(group, **values):
        return store.upsert(con, tid, group, values)

    stops = [
        ("Bozen", "stop", 0, "09:00", 46.4983, 11.3548, "Waltherplatz, Bozen", "Start in der Altstadt. Vor der Abfahrt Proviant mitnehmen."),
        ("Karersee", "sight", 1, "10:30", 46.4092, 11.5753, "Karerpassstraße, Welschnofen", "Den See auf dem Rundweg zu Fuß erkunden."),
        ("Pragser Wildsee", "sight", 2, "09:30", 46.6943, 12.0855, "St. Veit, Prags", "Morgens am Nordufer starten und am See entlang wandern."),
        ("Camping Toblacher See", "sleep", 2, "16:00", 46.7037, 12.2186, "Toblacher See 3, Toblach", "Stellplatz für zwei Nächte. Am Empfang nach der Gästekarte fragen."),
        ("Drei Zinnen", "sight", 3, "08:00", 46.6120, 12.2958, "Auronzohütte, Auronzo di Cadore", "Früh zur Wanderung aufbrechen. Wetter und Zufahrt vorab prüfen."),
        ("Cortina d’Ampezzo", "stop", 5, "11:00", 46.5405, 12.1357, "Corso Italia, Cortina d’Ampezzo", "Mittagspause und Vorräte auffüllen."),
        ("Grödner Joch", "sight", 7, "14:00", 46.5490, 11.8086, "Passo Gardena, Wolkenstein", "Aussichtspunkt an der Passhöhe."),
    ]
    for title, kind, offset, time, lat, lon, addr, notes in stops:
        add("stops", title=title, kind=kind, date=day(offset), time=time, lat=lat, lon=lon,
            tags=["Schlafen", "Camping"] if kind == "sleep" else [],
            address=addr, notes=notes, done=offset < 2, end_date=day(4) if kind == "sleep" else None)
    add("stops", title="Villnößtal", kind="sight", lat=46.642, lon=11.722, tags=["Wandern"],
        notes="Zeit für einen Spaziergang einplanen, wenn das Wetter passt.")
    add("stops", title="Seceda", kind="sight", saved=True, lat=46.6003, lon=11.7274,
        address="St. Ulrich in Gröden", notes="Als Ausflug bei klarer Sicht vorgemerkt.")
    add("purchases", title="Gaskartusche", quantity=2, unit="Stk.", estimated_cost=17.8, paid=True,
        done=True, date=day(0), notes="Zwei Kartuschen für den Campingkocher.")
    add("purchases", title="Wanderkarte Dolomiten", estimated_cost=14.9, date=day(3))
    add("purchases", title="Stirnlampe", estimated_cost=34.95, date=day(3), tags=["Elektronik", "Wandern"],
        notes="Vor der nächsten Wanderung besorgen.")
    add("mobility", title="Tanken in Bozen", kind="fuel", date=day(0), quantity=36.4, odometer=83214,
        estimated_cost=64.06, paid=True, done=True)
    add("mobility", title="Parkplatz Pragser Wildsee", kind="parking", date=day(2), estimated_cost=18)
    add("mobility", title="Bahnfahrt ins Pustertal", kind="train", date=day(4), origin="Toblach", destination="Bruneck",
        departure=f"{day(4)}T09:20", arrival=f"{day(4)}T09:56", estimated_cost=12)
    add("expenses", title="Stellplatz am Toblacher See", category="lodging", amount=84, status="planned", date=day(2))
    add("expenses", title="Mittagessen in Bozen", category="food", amount=27.5, date=day(0))
    for name, quantity, unit in [("Haferflocken", 500, "g"), ("Trinkwasser", 4, "l"), ("Nudeln", 750, "g")]:
        add("pantry", name=name, quantity=quantity, unit=unit)
    for name, quantity, unit in [("Brot", 1, "Stk."), ("Bergkäse", 300, "g"), ("Tomaten", 4, "Stk.")]:
        add("shopping", name=name, quantity=quantity, unit=unit)
    apples = add("shopping", name="Äpfel", quantity=4, unit="Stk.")
    store.checkout(con, tid, models.Checkout(items=[{"id": apples["id"], "quantity": 4}],
                  amount=2.8, date=day(1), title="Obst vom Markt", request_id="demo-markteinkauf"))
