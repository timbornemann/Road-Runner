"""Exercise application entry points with a real, disposable SQLite database."""

import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient

from . import store
from .app import app


class TravelAPI(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        env = patch.dict(os.environ, {"RR_DATA_DIR": directory.name})
        env.start()
        self.addCleanup(env.stop)
        self.client = self.enterContext(TestClient(app))
        self.tid = self.client.post("/api/trips", json={"name": "Echte Reise", "budget": 200}).json()["id"]
        self.path = f"/api/trips/{self.tid}"

    def post(self, route, body):
        response = self.client.post(self.path + "/" + route, json=body)
        self.assertLess(response.status_code, 300, response.text)
        return response.json()

    def edit(self, route, body):
        response = self.client.patch(self.path + "/" + route, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def aggregate(self):
        return self.client.get(self.path).json()

    def test_demo_and_restart_migration(self):
        demo, real = self.client.get("/api/trips").json()
        self.assertTrue(demo["is_demo"])
        self.assertFalse(real["is_demo"])
        demo_path = f"/api/trips/{demo['id']}"
        demo_data = self.client.get(demo_path).json()
        self.assertGreaterEqual(len(demo_data["stops"]), 6)
        self.assertEqual(self.client.get("/api/health").json()["schema_version"], 5)
        for group in store.COLLECTIONS:
            self.assertTrue(demo_data[group])
            self.assertTrue(all(isinstance(entry["tags"], list) for entry in demo_data[group]))
        data = self.aggregate()
        self.assertTrue(all(not v for k, v in data.items() if k not in ("trip", "notebook")))
        self.assertEqual(data["notebook"], {"topics": [], "notes": [], "links": [], "areas": []})
        self.post("purchases", {"title": "Kocher", "estimated_cost": 89})
        self.assertEqual(self.client.delete(demo_path).status_code, 204)
        with TestClient(app) as restarted:
            self.assertEqual([t["id"] for t in restarted.get("/api/trips").json()], [self.tid])
            self.assertEqual(restarted.get(self.path).json()["purchases"][0]["title"], "Kocher")

    def test_partial_checkout_multi_item_atomic_and_idempotent(self):
        milk = self.post("shopping", {"name": "Milch", "quantity": 3, "unit": "l"})
        rice = self.post("shopping", {"name": "Reis", "quantity": 1, "unit": "kg"})
        self.post("pantry", {"name": "milch", "unit": "L", "quantity": 0.3})
        body = {
            "items": [{"id": milk["id"], "quantity": 1.5}, {"id": rice["id"], "quantity": 2}],
            "amount": 7.5, "currency": "CHF", "exchange_rate": 1.05, "request_id": "bon-1",
        }
        response = self.client.post(self.path + "/shopping/checkout", json=body)
        self.assertEqual(response.status_code, 409)
        unchanged = self.aggregate()
        self.assertEqual(unchanged["expenses"], [])
        self.assertEqual(unchanged["shopping"][0]["quantity"], 3)
        self.assertEqual(unchanged["pantry"][0]["quantity"], 0.3)
        body["items"][1]["quantity"] = 1
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.client.post(self.path + "/shopping/checkout", json=body), range(4)))
        self.assertEqual([r.status_code for r in responses], [200] * 4)
        self.assertEqual(len({r.json()["id"] for r in responses}), 1)
        data = self.aggregate()
        self.assertEqual(len(data["expenses"]), 1)
        receipt = data["expenses"][0]
        self.assertEqual((receipt["base_amount"], receipt["amount"], receipt["status"]), (7.88, 7.5, "paid"))
        self.assertEqual([l["quantity"] for l in receipt["items"]], [1.5, 1])
        self.assertEqual([(l["quantity"], l["done"]) for l in data["shopping"]], [(1.5, False), (0, True)])
        self.assertEqual([l["quantity"] for l in data["pantry"]], [1.8, 1])
        conflict = self.client.post(self.path + "/shopping/checkout", json={**body, "amount": 9})
        self.assertEqual(conflict.status_code, 409)
        remaining = self.post(f"pantry/{data['pantry'][0]['id']}/consume", {"quantity": 1.55})
        self.assertEqual(remaining["quantity"], 0.25)
        excess = self.client.post(self.path + f"/pantry/{remaining['id']}/consume", json={"quantity": 0.251})
        self.assertEqual(excess.status_code, 409)
        with TestClient(app) as restarted:
            replay = restarted.post(self.path + "/shopping/checkout", json=body)
            self.assertEqual(replay.json(), receipt)
            self.assertEqual(restarted.get(self.path).json()["pantry"][0]["quantity"], 0.25)

    def test_currency_and_linked_expenses(self):
        purchase = self.post("purchases", {"title": "Mautbox", "estimated_cost": 43, "currency": "CHF", "exchange_rate": 1.08})
        pid = purchase["id"]
        eid = purchase["expense_id"]
        ledger = self.aggregate()["expenses"]
        self.assertEqual(len(ledger), 1)
        self.assertEqual((ledger[0]["id"], ledger[0]["status"], ledger[0]["base_amount"]), (eid, "planned", 46.44))
        self.edit(f"expenses/{eid}", {"status": "paid", "amount": 44, "date": "2027-03-22"})
        p = self.aggregate()["purchases"][0]
        self.assertEqual((p["paid"], p["done"], p["estimated_cost"], p["date"]), (True, False, 44, "2027-03-22"))
        self.edit(f"purchases/{pid}", {"estimated_cost": 40, "done": True})
        ledger = self.aggregate()["expenses"]
        self.assertEqual(len(ledger), 1)
        self.assertEqual((ledger[0]["id"], ledger[0]["amount"], ledger[0]["base_amount"]), (eid, 40, 43.2))
        self.assertEqual(self.client.patch(self.path, json={"currency": "USD"}).status_code, 409)
        self.assertEqual(self.client.delete(self.path + f"/expenses/{eid}").status_code, 204)
        p = self.aggregate()["purchases"][0]
        self.assertEqual((p["expense_id"], p["paid"], p["done"], p["estimated_cost"]), (None, False, True, 0))
        self.edit(f"purchases/{pid}", {"estimated_cost": 12})
        self.assertEqual(self.client.delete(self.path + f"/purchases/{pid}").status_code, 204)
        self.assertFalse(self.aggregate()["expenses"])
        missing_rate = self.client.post(self.path + "/expenses", json={"title": "Boot", "currency": "NOK", "amount": 80})
        self.assertEqual(missing_rate.status_code, 422)

    def test_rollback_when_second_stock_update_fails(self):
        self.post("pantry", {"name": "Voll", "quantity": "9999999999.999"})
        one = self.post("shopping", {"name": "Brötchen"})
        two = self.post("shopping", {"name": "Voll"})
        before = self.aggregate()
        result = self.client.post(self.path + "/shopping/checkout", json={
            "items": [{"id": one["id"], "quantity": 1}, {"id": two["id"], "quantity": 1}],
            "amount": 3, "request_id": "test-abbruch"})
        self.assertEqual(result.status_code, 422)
        self.assertEqual(self.aggregate(), before)

    def test_transport_payment_and_travel_dates_are_independent(self):
        ride = self.post("mobility", {"kind": "ferry", "title": "Fähre", "date": "2027-03-22",
                          "estimated_cost": 55, "origin": "Kiel", "destination": "Oslo",
                          "departure": "2027-03-22T14:00", "arrival": "2027-03-23T10:00"})
        self.edit(f"expenses/{ride['expense_id']}", {"status": "paid", "date": "2027-03-01"})
        ride = self.aggregate()["mobility"][0]
        self.assertEqual((ride["done"], ride["paid"], ride["date"]), (False, True, "2027-03-22"))
        self.edit(f"mobility/{ride['id']}", {"done": True})
        self.assertEqual(self.aggregate()["expenses"][0]["date"], "2027-03-01")

    def test_route_order_is_scoped_and_survives_export(self):
        a = self.post("stops", {"title": "Bucht", "saved": True})
        b = self.post("stops", {"title": "Camping", "kind": "sleep", "lat": 53.0, "lon": 10.2})
        self.edit(f"stops/{a['id']}", {"date": "2027-03-01", "time": "10:20", "saved": False, "done": True})
        orphan = self.client.post(self.path + "/mobility", json={"title": "Parken", "stop_id": 1})
        self.assertEqual(orphan.status_code, 404)
        ride = self.post("mobility", {"title": "Tanken", "stop_id": b["id"], "kind": "fuel", "quantity": 10.9,
                                        "odometer": 900, "estimated_cost": 20, "paid": True})
        wrong = self.client.put(self.path + "/stops/order", json={"ids": [b["id"], b["id"]]})
        self.assertEqual(wrong.status_code, 409)
        order = [b["id"], a["id"]]
        result = self.client.put(self.path + "/stops/order", json={"ids": order})
        self.assertEqual([s["id"] for s in result.json()], order)
        export = self.client.get(self.path + "/export")
        self.assertTrue(export.headers["content-disposition"].startswith("attachment"))
        payload = export.json()
        self.assertEqual(payload["schema_version"], 5)
        self.assertEqual([s["id"] for s in payload["stops"]], order)
        self.assertEqual(payload["mobility"][0]["expense_id"], payload["expenses"][0]["id"])
        self.assertEqual(self.client.delete(self.path + f"/stops/{b['id']}").status_code, 204)
        detached = self.aggregate()["mobility"][0]
        self.assertEqual((detached["id"], detached["stop_id"]), (ride["id"], None))

    def test_cross_trip_and_validation(self):
        other_id = self.client.post("/api/trips", json={"name": "Zweite Reise"}).json()["id"]
        item = self.post("pantry", {"name": "Mehl", "quantity": 1})
        wrong = f"/api/trips/{other_id}/pantry/{item['id']}"
        self.assertEqual(self.client.patch(wrong, json={"quantity": 2}).status_code, 404)
        self.assertEqual(self.client.delete(wrong).status_code, 404)
        self.assertEqual(self.client.post(wrong + "/consume", json={"quantity": 1}).status_code, 404)
        for group, body in [("pantry", {"name": "X", "quantity": -1}),
                            ("stops", {"title": "X", "lat": 11}),
                            ("expenses", {"title": "X", "amount": 1, "currency": "CAD", "exchange_rate": 0}),
                            ("mobility", {"title": "X", "departure": "2027-03-02T12:00", "arrival": "2027-03-02T11:00"})]:
            with self.subTest(group=group):
                self.assertEqual(self.client.post(self.path + "/" + group, json=body).status_code, 422)
        self.assertEqual(self.client.get("/api/missing").status_code, 404)

    def test_edit_tags_in_all_collections_and_export(self):
        cases = {"stops": {"title": "Bucht"}, "purchases": {"title": "Zelt", "estimated_cost": 20},
                 "pantry": {"name": "Salz"}, "shopping": {"name": "Pfeffer"},
                 "mobility": {"title": "Bus", "estimated_cost": 5}, "expenses": {"title": "Eis", "amount": 4}}
        for group, payload in cases.items():
            with self.subTest(group=group):
                item = self.post(group, {**payload, "tags": ["  Meer ", "meer", "Straße", "STRASSE", " ", "Strand"]})
                tags = ["Meer", "Straße", "Strand"]
                self.assertEqual(item["tags"], tags)
                if group in store.COSTED:
                    linked = next(e for e in self.aggregate()["expenses"] if e["id"] == item["expense_id"])
                    self.assertEqual(linked["tags"], tags)
                url = f"{group}/{item['id']}"
                self.assertEqual(self.edit(url, payload)["tags"], tags)
                exported = self.client.get(self.path + "/export").json()
                self.assertEqual(next(e["tags"] for e in exported[group] if e["id"] == item["id"]), tags)
                self.assertEqual(self.edit(url, {"tags": []})["tags"], [])
                self.assertEqual(self.client.patch(self.path + "/" + url, json={"tags": "Meer"}).status_code, 422)
                if group in store.COSTED:
                    eid = item["expense_id"]
                    self.edit(f"expenses/{eid}", {"tags": ["Buchung"]})
                    self.assertEqual(next(e["tags"] for e in self.aggregate()[group] if e["id"] == item["id"]), ["Buchung"])
                    self.edit(url, {"estimated_cost": 9})
                    self.assertEqual(next(e["tags"] for e in self.aggregate()["expenses"] if e["id"] == eid), ["Buchung"])
                    self.edit(url, {"tags": ["Quelle"], "estimated_cost": 10})
                    self.assertEqual(next(e["tags"] for e in self.aggregate()["expenses"] if e["id"] == eid), ["Quelle"])
                    self.edit(f"expenses/{eid}", {"amount": 12})
                    self.assertEqual(next(e["tags"] for e in self.aggregate()[group] if e["id"] == item["id"]), ["Quelle"])

    def test_checkout_preserves_and_merges_inventory_tags(self):
        self.post("pantry", {"name": "Reis", "tags": ["Vorrat", "Bio"]})
        one = self.post("shopping", {"name": "Reis", "quantity": 3, "tags": ["bio", "Camping"]})
        two = self.post("shopping", {"name": "Brot", "tags": ["Frühstück", "Bio"]})
        body = {"request_id": "getaggter-bon", "amount": 5,
                "items": [{"id": one["id"], "quantity": 1}, {"id": two["id"], "quantity": 1}]}
        receipt = self.post("shopping/checkout", body)
        self.assertEqual(receipt["tags"], ["bio", "Camping", "Frühstück"])
        self.assertEqual(self.post("shopping/checkout", body), receipt)
        self.edit(f"expenses/{receipt['id']}", {"tags": ["Beleg"]})
        data = self.aggregate()
        self.assertEqual([(item["tags"], item["quantity"]) for item in data["pantry"]],
                         [(["Vorrat", "Bio", "Camping"], 2), (["Frühstück", "Bio"], 1)])
        self.assertEqual(data["shopping"][0]["tags"], ["bio", "Camping"])
        self.assertEqual(data["shopping"][0]["quantity"], 2)
        self.assertEqual(data["expenses"][0]["tags"], ["Beleg"])

    def test_upgrade_v1_visible_order_and_keep_user_order_on_restart(self):
        a = self.post("stops", {"title": "Später", "date": "2027-06-04"})
        s = self.post("stops", {"title": "Merkliste", "saved": True})
        b = self.post("stops", {"title": "Flexibel"})
        c = self.post("stops", {"title": "Früher morgens", "date": "2027-06-03", "time": "08:00"})
        d = self.post("stops", {"title": "Früher abends", "date": "2027-06-03", "time": "19:00"})
        line = self.post("shopping", {"name": "Milch"})
        body = {"request_id": "alter-bon", "amount": 2, "items": [{"id": line["id"], "quantity": 1}]}
        receipt = self.post("shopping/checkout", body)
        # v1 had exactly these tables, untagged records and independent positions across days.
        with store.session(True) as con:
            con.execute("UPDATE records SET data=json_remove(data, '$.tags')")
            con.execute("UPDATE checkouts SET result=json_remove(result, '$.tags')")
            for pos, item in enumerate([a, s, b, d, c]):
                con.execute("UPDATE records SET data=json_set(data, '$.position', ?) WHERE id=?", (pos, item["id"]))
            con.execute("PRAGMA user_version=1")
        with TestClient(app) as upgraded:
            self.assertEqual(upgraded.get("/api/health").json()["schema_version"], 5)
            data = upgraded.get(self.path).json()
            self.assertEqual([item["id"] for item in data["stops"]], [item["id"] for item in [d, c, a, b, s]])
            self.assertEqual([item["position"] for item in data["stops"]], list(range(5)))
            self.assertTrue(all(item["tags"] == [] for group in store.COLLECTIONS for item in data[group]))
            self.assertEqual(upgraded.post(self.path + "/shopping/checkout", json=body).json(), receipt)
            order = [item["id"] for item in [b, a, d, c, s]]
            self.assertEqual(upgraded.put(self.path + "/stops/order", json={"ids": order}).status_code, 200)
        self.edit(f"stops/{b['id']}", {"date": "2027-12-30", "tags": ["Winter"]})
        self.edit(f"stops/{d['id']}", {"date": None})
        with TestClient(app) as restarted:
            data = restarted.get(self.path + "/export").json()
            self.assertEqual([item["id"] for item in data["stops"]], order)
            self.assertEqual(data["stops"][0]["tags"], ["Winter"])
        self.edit(f"stops/{s['id']}", {"saved": False})
        new_saved = self.post("stops", {"title": "Vormerkung", "saved": True})
        new_stop = self.post("stops", {"title": "Neuer Stopp", "date": "2020-01-01"})
        self.assertEqual([item["id"] for item in self.aggregate()["stops"]], order + [new_stop["id"], new_saved["id"]])
        self.edit(f"stops/{c['id']}", {"saved": True, "date": None})
        self.assertEqual(self.aggregate()["stops"][-1]["id"], c["id"])
        self.edit(f"stops/{c['id']}", {"saved": False})
        self.assertEqual([item["id"] for item in self.aggregate()["stops"][-3:]], [new_stop["id"], c["id"], new_saved["id"]])

    def test_dates_are_optional_and_independent_of_order_and_trip_period(self):
        self.client.patch(self.path, json={"start_date": "2027-09-01", "end_date": "2027-09-05"}).raise_for_status()
        first = self.post("stops", {"title": "Flexibel", "time": "13:20"})
        last = self.post("stops", {"title": "Übernachtung", "kind": "sleep", "date": "2027-06-08", "end_date": "2027-06-10"})
        route = [first["id"], last["id"]]
        self.edit(f"stops/{first['id']}", {"date": "2027-12-01"})
        invalid = self.client.patch(self.path + f"/stops/{last['id']}", json={"date": "2027-06-15"})
        self.assertEqual(invalid.status_code, 422)
        self.edit(f"stops/{last['id']}", {"date": None, "end_date": None})
        self.assertEqual([s["id"] for s in self.aggregate()["stops"]], route)
        self.assertFalse(self.aggregate()["stops"][1]["saved"])


if __name__ == "__main__":
    unittest.main()
