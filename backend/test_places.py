import base64
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient

from . import store
from .app import app
from .test_journal import PNG


class PlaceAPI(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        self.client = self.enterContext(TestClient(app))
        trip = self.client.post("/api/trips", json={"name": "Lofoten"}).json()
        self.path = f"/api/trips/{trip['id']}"

    def post(self, path, **data):
        response = self.client.post(self.path + path, json=data)
        response.raise_for_status()
        return response.json()

    def test_repeat_visits_keep_shared_place_and_independent_schedule(self):
        site = self.post("/places", title="Zeltwiese", category="Schlafplatz", icon_type="emoji", icon="🏕️")
        pid = site["id"]
        self.assertEqual(self.client.get(self.path + "/visits").json(), [])
        first = self.post("/visits", place_id=pid, date="2027-07-12", end_date="2027-07-13")
        second = self.post("/visits", place_id=pid, date="2027-07-23", position=0)
        self.assertEqual((first["place_id"], second["place_id"], first["kind"]), (pid, pid, "sleep"))
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual([s["id"] for s in self.client.get(self.path + "/visits").json()], [second["id"], first["id"]])
        self.client.patch(self.path + f"/places/{pid}", json={"description": "Hinter dem Haupthaus", "lat": 68, "lon": 14}).raise_for_status()
        self.client.patch(self.path + f"/visits/{first['id']}", json={"done": True}).raise_for_status()
        # Even a legacy client editing the second visit sees the shared address on the first.
        self.client.patch(self.path + f"/stops/{second['id']}", json={"address": "Hafenstraße"}).raise_for_status()
        trip = self.client.get(self.path).json()
        self.assertEqual(len(trip["places"]), 1)
        self.assertEqual([(s["date"], s["done"]) for s in trip["visits"]], [("2027-07-23", False), ("2027-07-12", True)])
        self.assertTrue(all(s["notes"] == "Hinter dem Haupthaus" and s["address"] == "Hafenstraße" for s in trip["stops"]))
        self.assertEqual(self.client.delete(self.path + f"/places/{pid}").status_code, 409)

        # Old clients may send an additional visit's ID when they mean its geographic place.
        linked = [second["id"], first["id"]]
        entry = self.post("/journal", date="2027-07-23", text="Am Meer", stop_ids=linked)
        area = self.post("/notebook/areas", name="Hafen", stop_ids=linked)
        topic = self.post("/notebook/topics", title="Unterkunft")
        link = self.post("/notebook/links", source_type="topic", source_id=topic["id"], target_type="stop", target_id=second["id"])
        ride = self.post("/mobility", title="Fähre", stop_id=second["id"])
        self.client.put(self.path + f"/favorites/{second['id']}").raise_for_status()
        self.assertEqual((entry["stop_ids"], area["stop_ids"], link["target_id"], ride["stop_id"]), ([pid], [pid], pid, pid))
        self.client.delete(self.path + f"/visits/{first['id']}").raise_for_status()
        self.assertEqual([v["id"] for v in self.client.get(self.path + "/visits").json()], [second["id"]])
        self.client.delete(self.path + f"/visits/{second['id']}").raise_for_status()
        trip = self.client.get(self.path).json()
        self.assertEqual(trip["visits"], [])
        self.assertEqual((trip["favorite_stop_ids"], trip["journal_entries"][0]["stop_ids"], trip["notebook"]["areas"][0]["stop_ids"]), ([pid], [pid], [pid]))
        self.assertEqual(trip["notebook"]["links"], [link])
        self.assertEqual(trip["mobility"][0]["stop_id"], pid)
        third = self.post("/visits", place_id=pid)
        self.assertNotIn(third["id"], linked)
        self.assertEqual(self.client.get(self.path + f"/visits/{first['id']}").status_code, 404)

    def test_osm_identity_trip_scope_and_transactional_inline_creation(self):
        fields = {"title": "Ryten", "category": "Berg", "osm_type": "node", "osm_id": 123}
        with ThreadPoolExecutor(max_workers=4) as workers:
            result = list(workers.map(lambda _: self.post("/places", **fields), range(4)))
        self.assertTrue(all(p == result[0] for p in result))
        updated = self.client.patch(self.path + f"/places/{result[0]['id']}", json={"title": "Mein Ryten"}).json()
        self.assertEqual(self.post("/places", **fields), updated)
        other = self.client.post("/api/trips", json={"name": "Wiedersehen"}).json()["id"]
        foreign = f"/api/trips/{other}"
        other_place = self.client.post(foreign + "/places", json=fields).json()
        self.assertNotEqual(other_place["id"], updated["id"])
        self.assertEqual(self.client.post(foreign + "/visits", json={"place_id": updated["id"]}).status_code, 404)
        self.assertEqual(self.client.post(self.path + "/visits", json={"place": {"title": "Neuer Ort"}, "variant_id": 12345}).status_code, 404)
        self.assertEqual(self.client.get(self.path + "/places").json(), [updated])
        visit = self.post("/visits", place={"title": "Kap", "category": "Berg"})
        self.assertEqual((visit["kind"], self.client.get(self.path + f"/places/{visit['place_id']}").json()["title"]), ("sight", "Kap"))
        self.assertEqual(self.client.put(self.path + "/visits/order", json={"ids": []}).status_code, 409)
        self.assertEqual(self.client.post(self.path + "/places", json={"title": "Ungültig", "links": [{"label": "Kap", "url": "file:///etc/hosts"}]}).status_code, 422)

    def test_cover_and_metadata_export_and_copy(self):
        fields = {"title": "Aussicht", "links": [{"label": "Wanderkarte", "url": "https://example.com/route"}],
                  "osm_type": "way", "osm_id": 11, "icon_type": "emoji", "icon": "🧑🏽‍🚀"}
        def attach(method, path, content, values):
            return self.client.request(method, self.path + path, data={"payload": json.dumps(values)},
                                       files={"file": ("bild.png", content, "image/png")})
        self.assertEqual(attach("POST", "/places/with-image", b"unlesbar", fields).status_code, 415)
        self.assertEqual(self.client.get(self.path + "/places").json(), [])
        res = attach("POST", "/places/with-image", PNG, fields)
        res.raise_for_status()
        place = res.json()
        pid = place["id"]
        self.assertEqual(self.client.get(place["image"]["url"]).content, PNG)
        self.assertEqual(attach("POST", "/places/with-image", PNG + b"andere", fields).json(), place)
        self.assertEqual(self.client.get(place["image"]["url"]).content, PNG)
        self.assertEqual(attach("PATCH", f"/places/{pid}/with-image", PNG, {"lat": 42}).status_code, 422)
        replacement = PNG * 3
        edited = attach("PATCH", f"/places/{pid}/with-image", replacement, {"description": "Über der Bucht"}).json()
        self.assertNotEqual(edited["image"]["url"], place["image"]["url"])
        self.client.put(self.path + f"/favorites/{pid}").raise_for_status()
        foreign = self.client.post("/api/trips", json={"name": "Nächstes Jahr"}).json()["id"]
        copy = self.client.post(f"/api/trips/{foreign}/favorites/{pid}/copy").json()
        self.assertEqual(self.client.get(f"/api/trips/{foreign}/places/{copy['id']}/image").content, replacement)
        self.assertEqual(self.client.get(f"/api/trips/{foreign}/places/{pid}/image").status_code, 404)
        with TestClient(app) as restarted:
            full = restarted.get(self.path + "/export").json()
            self.assertEqual(full["schema_version"], 5)
            self.assertEqual(full["places"][0]["links"], fields["links"])
            self.assertEqual(full["places"][0]["icon"], fields["icon"])
            self.assertEqual(base64.b64decode(full["place_image_content"][str(pid)]), replacement)
            self.assertEqual(restarted.delete(place["image"]["url"]).status_code, 204)
            self.assertEqual(restarted.get(place["image"]["url"]).status_code, 404)
            self.assertIsNone(restarted.get(self.path + f"/places/{pid}").json()["image"])


class PlaceMigration(unittest.TestCase):
    def test_v4_migration_preserves_links_and_separate_same_name_places(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        with patch.object(store, "SCHEMA_VERSION", 4), TestClient(app) as old:
            tid = old.post("/api/trips", json={"name": "Nordland"}).json()["id"]
            path = f"/api/trips/{tid}"
            def add(endpoint, **body):
                response = old.post(path + endpoint, json=body)
                response.raise_for_status()
                return response.json()
            saved = add("/stops", title="Hafen", saved=True)
            stage = add("/stages", name="Wasser")
            variant = add(f"/stages/{stage['id']}/variants", name="Westen")
            planned = add("/stops", title="Hafen", stage_id=stage["id"], variant_id=variant["id"], kind="sleep",
                          date="2027-06-20", end_date="2027-06-22", time="18:00", done=True)
            add("/journal", date="2027-06-20", text="Regen", stop_ids=[planned["id"], saved["id"]])
            add("/notebook/areas", name="Insel", stop_ids=[saved["id"]])
            add("/mobility", title="Bus", stop_id=saved["id"])
            topic = add("/notebook/topics", title="Häfen")
            add("/notebook/links", source_type="topic", source_id=topic["id"], target_type="stop", target_id=saved["id"])
            old.put(path + f"/favorites/{planned['id']}").raise_for_status()
            previous = old.get(path).json()
            with store.session() as con:
                self.assertIsNone(con.execute("SELECT name FROM sqlite_master WHERE name='places'").fetchone())
        with TestClient(app) as new:
            current = new.get(path + "/export").json()
            self.assertEqual(current["schema_version"], 5)
            self.assertEqual([p["id"] for p in current["places"]], [saved["id"], planned["id"]])
            self.assertEqual(len(current["visits"]), 1)
            visit = current["visits"][0]
            self.assertEqual(visit["place_id"], planned["id"])
            self.assertTrue(all(visit[k] == planned[k] for k in ("kind", "date", "end_date", "time", "done", "stage_id", "variant_id")))
            for group in ("trip", "journal_entries", "notebook", "favorite_stop_ids", "mobility", "stages"):
                self.assertEqual(current[group], previous[group])
            for stop, before in zip(current["stops"], previous["stops"], strict=True):
                self.assertEqual({k: stop[k] for k in before}, before)
