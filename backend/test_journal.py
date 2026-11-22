"""Exercise the diary, saved favorites and media through their HTTP entry points."""

import base64
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient

from . import journal_media, store
from .app import app


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4L8AAAAASUVORK5CYII=")


class JournalAPI(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory}))
        self.client = self.enterContext(TestClient(app))
        self.tid = self.client.post("/api/trips", json={"name": "Lofoten"}).json()["id"]
        self.path = f"/api/trips/{self.tid}"
        second = self.client.post("/api/trips", json={"name": "Nächste Tour"}).json()["id"]
        self.next = f"/api/trips/{second}"

    def post(self, url, data):
        response = self.client.post(url, json=data)
        response.raise_for_status()
        return response.json()

    def test_entries_are_groupable_by_day_and_links_are_scoped(self):
        one = self.post(self.path + "/stops", {"title": "Strand"})["id"]
        two = self.post(self.path + "/stops", {"title": "Hafen"})["id"]
        other = self.post(self.next + "/stops", {"title": "Fremder Ort"})["id"]
        note = self.post(self.path + "/journal", {"date": "2027-06-07", "title": "Überfahrt",
                                                "text": "Leise See.", "stop_ids": [two, one, two]})
        path = self.path + f"/journal/{note['id']}"
        self.assertEqual(note["stop_ids"], [two, one])
        earlier = self.post(self.path + "/journal", {"date": "2027-06-05", "text": "Anreise"})
        same = self.post(self.path + "/journal", {"date": note["date"], "title": "Abend"})
        self.assertEqual([r["id"] for r in self.client.get(self.path).json()["journal_entries"]],
                         [earlier["id"], note["id"], same["id"]])
        self.assertEqual(self.client.patch(path, json={"text": "Ungültig", "stop_ids": [other]}).status_code, 404)
        self.assertEqual(self.client.patch(path, json={"date": "2027-02-30"}).status_code, 422)
        self.assertEqual(self.client.get(self.path + "/journal").json()[1], note)
        self.assertEqual(self.client.delete(self.next + f"/journal/{note['id']}").status_code, 404)
        self.client.delete(self.path + f"/stops/{one}").raise_for_status()
        revised = self.client.patch(path, json={"date": "2027-06-09", "title": "Später"}).json()
        self.assertEqual((revised["stop_ids"], revised["text"]), ([two], "Leise See."))
        self.client.delete(path).raise_for_status()
        self.assertEqual(len(self.client.get(self.path + "/journal").json()), 2)

    def test_favorites_copy_only_the_place_and_survive_deletion_of_original(self):
        stop = self.post(self.path + "/stops", {"title": "Camping", "kind": "sleep", "lat": 62, "lon": 9,
                                              "notes": "Westseite", "tags": ["ruhig"], "done": True, "date": "2027-06-08"})
        sid = stop["id"]
        self.assertEqual(self.client.put(self.next + f"/favorites/{sid}").status_code, 404)
        self.client.put(self.path + f"/favorites/{sid}").raise_for_status()
        self.assertEqual(self.client.get(self.path).json()["favorite_stop_ids"], [sid])
        self.assertIn({"stop": stop, "trip_id": self.tid, "trip_name": "Lofoten", "copied_to_trip_ids": []},
                      self.client.get("/api/favorites").json())
        with ThreadPoolExecutor(max_workers=3) as pool:
            copies = list(pool.map(lambda _: self.client.post(self.next + f"/favorites/{sid}/copy").json(), range(3)))
        self.assertEqual(copies[0], copies[1])
        self.assertEqual(copies[0], copies[2])
        listed = next(f for f in self.client.get("/api/favorites").json() if f["stop"]["id"] == sid)
        self.assertEqual(listed["copied_to_trip_ids"], [copies[0]["trip_id"]])
        saved = self.client.get(self.next).json()["stops"]
        self.assertEqual(len(saved), 1)
        self.assertTrue(saved[0]["saved"])
        self.assertFalse(saved[0]["done"])
        self.assertIsNone(saved[0]["date"])
        for key in ("title", "kind", "lat", "lon", "notes", "tags"):
            self.assertEqual(saved[0][key], stop[key])
        self.client.delete(self.path + f"/favorites/{sid}").raise_for_status()
        self.assertFalse(self.client.get(self.path).json()["favorite_stop_ids"])
        self.client.delete(self.path).raise_for_status()
        self.assertEqual(self.client.get(self.next).json()["stops"], saved)

    def test_media_only_note_requires_successful_upload(self):
        path = self.path + "/journal/with-media"
        fields = {"date": "2027-06-08", "filename": "Strand.png"}
        self.assertEqual(self.client.post(path, params=fields, content=b"unlesbar").status_code, 415)
        self.assertEqual(self.client.get(self.path + "/journal").json(), [])
        response = self.client.post(path, params=fields, content=PNG)
        self.assertEqual(response.status_code, 201, response.text)
        note = response.json()
        self.assertEqual((note["date"], note["title"], note["text"]), ("2027-06-08", "", ""))
        self.assertEqual(self.client.get(self.path + "/journal").json(), [note])
        self.assertEqual(self.client.get(note["media"][0]["url"]).content, PNG)

    def test_media_ranges_export_and_cascade(self):
        note = self.post(self.path + "/journal", {"date": "2027-06-07", "title": "Bilderbuch"})
        media_path = self.path + f"/journal/{note['id']}/media"
        # Span multiple streaming blocks, with an incomplete final base64 block.
        video = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42" + b"video" * 90001
        photo = self.client.post(media_path, params={"filename": "../Strand.png"}, content=PNG).json()
        movie = self.client.post(media_path, params={"filename": "Überfahrt.mp4"}, content=video).json()
        self.assertEqual((photo["filename"], photo["mime_type"], photo["size"]), ("Strand.png", "image/png", len(PNG)))
        self.assertEqual(movie["mime_type"], "video/mp4")
        twice = self.client.post(media_path, params={"filename": "Nochmals.png"}, content=PNG)
        self.assertEqual(twice.json(), photo)
        self.assertEqual(self.client.get(movie["url"]).content, video)
        one_range = self.client.get(movie["url"], headers={"Range": "bytes=16383-200000"})
        self.assertEqual((one_range.status_code, one_range.content), (206, video[16383:200001]))
        self.assertEqual(one_range.headers["content-range"], f"bytes 16383-200000/{len(video)}")
        self.assertEqual(self.client.get(movie["url"], headers={"Range": "bytes=-5"}).content, video[-5:])
        self.assertEqual(self.client.get(movie["url"], headers={"Range": "bytes=999999-"}).status_code, 416)
        self.assertEqual(self.client.head(movie["url"]).headers["content-length"], str(len(video)))
        foreign_url = self.next + f"/journal/{note['id']}/media/{photo['id']}"
        self.assertEqual(self.client.get(foreign_url).status_code, 404)
        self.assertEqual(self.client.delete(foreign_url).status_code, 404)
        self.assertEqual(self.client.post(media_path, params={"filename": "falsch.jpg"}, content=b"<html>").status_code, 415)
        with patch.object(journal_media, "MAX_SIZE", 8):
            self.assertEqual(self.client.post(media_path, params={"filename": "gross.png"}, content=PNG).status_code, 413)
            self.assertEqual(self.client.post(media_path, params={"filename": "lang.png"}, content=iter([PNG])).status_code, 413)
        with TestClient(app) as restarted:
            trip = restarted.get(self.path).json()
            self.assertEqual(trip["journal_entries"][0]["media"], [photo, movie])
            self.assertNotIn("journal_media_content", trip)
            export = restarted.get(self.path + "/export").json()
            self.assertEqual(export["journal_entries"], trip["journal_entries"])
            self.assertEqual(base64.b64decode(export["journal_media_content"][str(movie["id"])]), video)
            self.assertEqual(base64.b64decode(export["journal_media_content"][str(photo["id"])]), PNG)
            self.assertEqual(restarted.get(self.next + "/export").json()["journal_media_content"], {})
        self.client.delete(photo["url"]).raise_for_status()
        self.assertEqual(self.client.get(photo["url"]).status_code, 404)
        self.client.delete(self.path).raise_for_status()
        self.assertEqual(self.client.get(movie["url"]).status_code, 404)
        with store.session() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM journal_media WHERE id=?", (movie["id"],)).fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
