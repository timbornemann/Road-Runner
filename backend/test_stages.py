import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from .app import app


class StageAPI(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        self.client = self.enterContext(TestClient(app))
        trip = self.client.post("/api/trips", json={"name": "Norwegen"}).json()
        self.path = f"/api/trips/{trip['id']}"

    def post(self, path, **payload):
        response = self.client.post(self.path + path, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def test_switch_and_reorder_preserve_both_branches(self):
        coast = self.post("/stages", name="Lofoten", notes="Ein paar Tage Zeit nehmen")
        arrival = self.post("/stages", name="Anreise")
        base = f"/stages/{coast}/variants"
        beach = self.post(base, name="Küste")
        mountains = self.post(base, name="Berge", notes="Bei guter Sicht")
        first = self.post("/stops", title="Strand", stage_id=coast, variant_id=beach, notes="Abends hingehen")
        second = self.post("/stops", title="Gipfel", date="2027-05-04", stage_id=coast, variant_id=mountains)
        shared = self.post("/stops", title="Camping", stage_id=coast, kind="sleep")
        loose = self.post("/stops", title="Ohne Etappe")
        before = self.client.get(self.path).json()
        self.assertEqual(before["stages"][0]["active_variant_id"], beach)
        activation = self.client.put(self.path + f"{base}/{mountains}/activate")
        self.assertEqual(activation.status_code, 200, activation.text)
        reorder = self.client.put(self.path + "/stages/order", json={"ids": [arrival, coast]})
        self.assertEqual(reorder.status_code, 200, reorder.text)
        with TestClient(app) as restarted:
            export = restarted.get(self.path + "/export").json()
            self.assertEqual(export["stops"], before["stops"])
            self.assertEqual([s["id"] for s in export["stops"]], [first, second, shared, loose])
            self.assertEqual([s["id"] for s in export["stages"]], [arrival, coast])
            self.assertEqual(export["stages"][1]["active_variant_id"], mountains)
            self.assertEqual(export["stages"][1]["variants"][1]["notes"], "Bei guter Sicht")
            self.assertEqual(restarted.delete(self.path + f"/stages/{coast}").status_code, 204)
            stops = {s["id"]: s for s in restarted.get(self.path).json()["stops"]}
            self.assertTrue(stops[first]["saved"])
            self.assertTrue(all(not stops[sid]["saved"] for sid in (second, shared, loose)))
            self.assertTrue(all(s["stage_id"] is None and s["variant_id"] is None for s in stops.values()))

    def test_scope_validation_and_active_variant_deletion(self):
        one = self.post("/stages", name="Eins")
        two = self.post("/stages", name="Zwei")
        base = f"/stages/{one}/variants"
        active = self.post(base, name="A")
        other = self.post(base, name="B")
        stop = self.post("/stops", title="Hafen", stage_id=one, variant_id=active)
        wrong_stage = self.client.patch(self.path + f"/stops/{stop}", json={"stage_id": two})
        self.assertEqual(wrong_stage.status_code, 404)
        trip = self.client.post("/api/trips", json={"name": "Andere Reise"}).json()["id"]
        wrong_trip = self.client.post(f"/api/trips/{trip}/stops", json={"title": "Fremd", "stage_id": one})
        self.assertEqual(wrong_trip.status_code, 404)
        self.assertEqual(self.client.put(self.path + f"/stages/{two}/variants/{other}/activate").status_code, 404)
        self.assertEqual(self.client.put(self.path + "/stages/order", json={"ids": [one, one]}).status_code, 409)
        self.assertEqual(self.client.delete(self.path + f"{base}/{active}").status_code, 204)
        data = self.client.get(self.path).json()
        self.assertEqual(data["stages"][0]["active_variant_id"], other)
        self.assertIsNone(data["stops"][0]["variant_id"])
        self.assertFalse(data["stops"][0]["saved"])
