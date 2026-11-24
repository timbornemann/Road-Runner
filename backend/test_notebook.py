"""Notebook workflows across actual HTTP entry points and persisted trip data."""

import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient

from . import notebook_schema, store
from .app import app
from .test_journal import PNG


EMPTY_BOOK = {"topics": [], "notes": [], "areas": [], "links": []}


class NotebookAPI(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        self.client = self.enterContext(TestClient(app))
        self.tid = self.client.post("/api/trips", json={"name": "Küstentour", "currency": "CHF"}).json()["id"]
        self.path = f"/api/trips/{self.tid}"
        self.book = self.path + "/notebook"

    def post(self, url, **body):
        response = self.client.post(url, json=body)
        response.raise_for_status()
        return response.json()

    def trip_data(self):
        return self.client.get(self.path).json()

    def topic(self, title, parent=None):
        return self.post(self.book + "/topics", title=title, parent_id=parent)["id"]

    def note(self, topic, title, body=""):
        return self.post(self.book + "/notes", topic_id=topic, title=title, body=body)

    def test_move_nested_topics_and_notes_and_reject_cycles(self):
        one = self.topic("Anreise")
        two = self.topic("Rückreise")
        child = self.topic("Fähren", one)
        leaf = self.topic("Häfen", child)
        sibling = self.topic("Brücken", one)
        note = self.note(one, "Wissenswertes")
        other_note = self.note(two, "Abreise")
        self.client.patch(self.book + f"/topics/{sibling}", json={"position": 0}).raise_for_status()
        self.client.patch(self.book + f"/topics/{two}", json={"parent_id": one, "position": 1}).raise_for_status()
        self.client.patch(self.book + f"/topics/{leaf}", json={"parent_id": None, "position": 0}).raise_for_status()
        data = self.trip_data()["notebook"]
        self.assertEqual([(t["id"], t["position"]) for t in data["topics"] if t["parent_id"] == one],
                         [(sibling, 0), (two, 1), (child, 2)])
        self.assertEqual([t["id"] for t in data["topics"] if t["parent_id"] is None], [leaf, one])
        for parent in [child, one]:
            res = self.client.patch(self.book + f"/topics/{one}", json={"parent_id": parent})
            self.assertEqual(res.status_code, 409)
        self.assertEqual(self.trip_data()["notebook"], data)
        moved = self.client.patch(self.book + f"/notes/{note['id']}",
                                  json={"topic_id": two, "position": 0, "revision": 1}).json()
        self.assertEqual((moved["position"], moved["topic_id"], moved["revision"]), (0, two, 2))
        self.assertEqual([n["id"] for n in self.trip_data()["notebook"]["notes"]], [note["id"], other_note["id"]])
        self.client.delete(self.book + f"/topics/{one}").raise_for_status()
        data = self.trip_data()["notebook"]
        self.assertEqual([t["id"] for t in data["topics"]], [leaf])
        self.assertEqual(data["notes"], [])

    def test_implicit_position_changes_invalidate_stale_note_edits(self):
        origin = self.topic("Anreise")
        destination = self.topic("Aufenthalt")
        fixed = self.note(origin, "Start")["id"]
        moved = self.note(origin, "Fähre")["id"]
        following = self.note(origin, "Ankunft")["id"]
        displaced = self.note(destination, "Abendessen")["id"]
        url = self.book + "/notes/"
        self.client.patch(url + str(moved), json={"revision": 1, "topic_id": destination, "position": 0}).raise_for_status()
        notes = self.trip_data()["notebook"]["notes"]
        self.assertEqual([(n["id"], n["position"], n["revision"]) for n in notes],
                         [(fixed, 0, 1), (following, 1, 2), (moved, 0, 2), (displaced, 1, 2)])
        for note_id in [following, displaced]:
            stale = self.client.patch(url + str(note_id), json={"revision": 1, "position": 0})
            self.assertEqual(stale.status_code, 409)

        self.client.patch(url + str(displaced), json={"revision": 2, "position": 0}).raise_for_status()
        self.assertEqual(self.client.get(url + str(displaced)).json()["revision"], 3)
        self.assertEqual(self.client.get(url + str(moved)).json()["revision"], 3)
        self.client.delete(url + str(displaced), params={"revision": 3}).raise_for_status()
        stale = self.client.patch(url + str(moved), json={"revision": 3, "position": 1})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual([(n["id"], n["position"], n["revision"]) for n in self.trip_data()["notebook"]["notes"]],
                         [(fixed, 0, 1), (following, 1, 2), (moved, 0, 4)])

    def test_concurrent_note_edits_and_stale_task_update(self):
        note = self.note(self.topic("Wandern"), "Ausrüstung", "- [ ] Karte")
        url = self.book + f"/notes/{note['id']}"
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda body: self.client.patch(url, json={"revision": 1, "body": body}),
                                      ["- [x] Karte", "- [ ] Karte\n- [ ] Wasser"]))
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409])
        winner = next(r.json() for r in responses if r.status_code == 200)
        self.assertEqual(winner["revision"], 2)
        self.assertEqual(self.client.patch(url, json={"title": "Alter Titel"}).status_code, 422)
        self.assertEqual(self.client.delete(url, params={"revision": 1}).status_code, 409)
        self.assertEqual(self.client.get(url).json(), winner)
        self.client.patch(url, json={"revision": 2, "body": "- [x] Karte\n- [ ] Wasser"}).raise_for_status()
        with TestClient(app) as restarted:
            self.assertEqual(restarted.get(url).json()["revision"], 3)
            self.assertEqual(restarted.get(self.path + "/export").json()["notebook"]["notes"][0]["body"],
                             "- [x] Karte\n- [ ] Wasser")

    def test_linked_targets_and_expenses_are_created_atomically(self):
        topic = self.topic("Vorbereitung")
        source = {"source_type": "topic", "source_id": topic}
        create = self.book + "/links/create-target"
        purchase = {"target_type": "purchase", "fields": {"title": "Kocher", "estimated_cost": 23.45}}
        failed = self.client.post(create, json={**source, **purchase, "source_id": 9999})
        self.assertEqual(failed.status_code, 404)
        data = self.trip_data()
        self.assertEqual((data["purchases"], data["expenses"], data["notebook"]["links"]), ([], [], []))
        p = self.post(create, **source, **purchase)
        stop = self.post(create, **source, target_type="stop", fields={"title": "Klippen", "saved": True})
        data = self.trip_data()
        self.assertEqual(data["purchases"], [p["target"]])
        self.assertEqual(data["stops"], [stop["target"]])
        self.assertEqual(len(data["expenses"]), 1)
        e = data["expenses"][0]
        self.assertEqual((e["id"], e["source_id"], e["base_amount"], e["currency"], e["status"]),
                         (p["target"]["expense_id"], p["target"]["id"], 23.45, "CHF", "planned"))
        repeat = self.post(self.book + "/links", **source, target_type="purchase", target_id=p["target"]["id"])
        self.assertEqual(repeat, p["link"])
        self.post(self.book + "/links", **source, target_type="expense", target_id=e["id"])
        self.client.delete(self.path + f"/purchases/{p['target']['id']}").raise_for_status()
        self.assertEqual(self.trip_data()["notebook"]["links"], [stop["link"]])
        self.client.delete(self.book + f"/topics/{topic}").raise_for_status()
        self.assertEqual(self.trip_data()["stops"], [stop["target"]])
        self.assertEqual(self.trip_data()["notebook"], EMPTY_BOOK)

    def test_reference_types_and_membership_survive_export_and_clean_up(self):
        topic = self.topic("Küste")
        second = self.topic("Handbuch")
        note = self.note(topic, "Zusammenfassung")["id"]
        other = self.note(second, "Alternative")["id"]
        stage = self.post(self.path + "/stages", name="Nord")["id"]
        variant = self.post(self.path + f"/stages/{stage}/variants", name="Klippen")["id"]
        stop = self.post(self.path + "/stops", title="Nordkap")["id"]
        saved = self.post(self.path + "/stops", title="Vorgemerkt", saved=True)["id"]
        area = self.post(self.book + "/areas", name="Nordküste", stop_ids=[saved, stop, saved])
        self.assertEqual(area["stop_ids"], [saved, stop])
        source = {"source_type": "note", "source_id": note}
        targets = {"topic": second, "note": other, "stop": stop, "area": area["id"], "stage": stage,
                   "variant": variant, "journal": self.post(self.path + "/journal", date="2027-01-22", text="See")["id"]}
        for kind, route, values in [("purchase", "purchases", {"title": "Mütze"}),
                                    ("pantry", "pantry", {"name": "Reis"}),
                                    ("shopping", "shopping", {"name": "Brot"}),
                                    ("mobility", "mobility", {"title": "Zug"}),
                                    ("expense", "expenses", {"title": "Eis", "amount": 3})]:
            targets[kind] = self.post(self.path + "/" + route, **values)["id"]
        for kind, item_id in targets.items():
            self.post(self.book + "/links", **source, target_type=kind, target_id=item_id)
        back = self.post(self.book + "/links", source_type="topic", source_id=second, target_type="note", target_id=note)
        data = self.trip_data()["notebook"]
        self.assertEqual(len(data["links"]), len(targets) + 1)
        with TestClient(app) as restarted:
            export = restarted.get(self.path + "/export").json()
            self.assertEqual(export["schema_version"], 4)
            self.assertEqual(export["notebook"], data)
        self.client.delete(self.path + f"/stages/{stage}").raise_for_status()
        self.client.delete(self.path + f"/stops/{stop}").raise_for_status()
        data = self.trip_data()["notebook"]
        self.assertEqual(data["areas"][0]["stop_ids"], [saved])
        self.assertFalse(any(link["target_type"] in {"stop", "stage", "variant"} for link in data["links"]))
        self.assertIn(back, data["links"])
        self.client.delete(self.book + f"/notes/{note}").raise_for_status()
        self.assertEqual(self.trip_data()["notebook"]["links"], [])
        self.client.delete(self.book + f"/areas/{area['id']}").raise_for_status()
        self.assertEqual(self.trip_data()["stops"][0]["id"], saved)

    def test_cross_trip_validation_applies_to_both_ends_and_rolls_back(self):
        foreign_trip = self.post("/api/trips", name="Andere Reise")["id"]
        path = f"/api/trips/{foreign_trip}"
        foreign = self.post(path + "/notebook/topics", title="Fremdes Thema")["id"]
        foreign_stop = self.post(path + "/stops", title="Fremdes Ziel")["id"]
        stop = self.post(self.path + "/stops", title="See")["id"]
        topic = self.topic("Baden")
        note = self.note(topic, "Strände")
        area = self.post(self.book + "/areas", name="Westen", stop_ids=[stop])
        before = self.trip_data()
        src = {"source_type": "topic", "source_id": topic}
        url = self.book + "/links"
        for method, endpoint, body in [
            ("patch", self.book + f"/topics/{topic}", {"parent_id": foreign}),
            ("post", self.book + "/notes", {"topic_id": foreign, "title": "Unzulässig"}),
            ("patch", self.book + f"/notes/{note['id']}", {"revision": 1, "topic_id": foreign}),
            ("post", url, {**src, "target_type": "stop", "target_id": foreign_stop}),
            ("post", url, {**src, "source_id": foreign, "target_type": "stop", "target_id": stop}),
            ("post", url, {**src, "target_type": "purchase", "target_id": stop}),
            ("patch", self.book + f"/areas/{area['id']}", {"name": "Neu", "stop_ids": [stop, foreign_stop]}),
        ]:
            with self.subTest(body=body):
                self.assertEqual(self.client.request(method, endpoint, json=body).status_code, 404)
        self.assertEqual(self.trip_data(), before)


class UpgradeNotebook(unittest.TestCase):
    def test_upgrade_v3_preserves_all_existing_tables_and_diary_bytes(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        # Build the previous schema with realistic pre-existing bookings, stop order and diary media.
        with patch.object(notebook_schema, "migrate"), patch.object(store, "SCHEMA_VERSION", 3), TestClient(app) as old:
            tid = old.get("/api/trips").json()[0]["id"]
            path = f"/api/trips/{tid}"
            url = path + "/journal/with-media"
            entry = old.post(url, params={"date": "2027-01-15", "filename": "alt.png"}, content=PNG).json()
            self.assertEqual(old.get("/api/health").json()["schema_version"], 3)
        with store.session() as con:
            tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence'")]
            self.assertNotIn("notebook_topics", tables)
            before = {table: con.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall() for table in tables}
        with TestClient(app) as upgraded:
            self.assertEqual(upgraded.get("/api/health").json()["schema_version"], 4)
            self.assertEqual(upgraded.get(path).json()["notebook"], EMPTY_BOOK)
            self.assertEqual(upgraded.get(entry["media"][0]["url"]).content, PNG)
            with store.session() as con:
                for table in tables:
                    self.assertEqual(con.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall(), before[table])
            created = upgraded.post(path + "/notebook/topics", json={"title": "Nach dem Update"}).json()
        with TestClient(app) as restarted:
            self.assertEqual(restarted.get(path + "/export").json()["notebook"]["topics"], [created])
