import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient

from . import geo_services
from .app import app


class MapServices(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory, "RR_MCP_ENABLED": "false"}))
        self.web = self.enterContext(TestClient(app))
        self.tid = self.web.post("/api/trips", json={"name": "Straßentest"}).json()["id"]
        self.path = f"/api/trips/{self.tid}"
        self.upstream = self.enterContext(patch.object(geo_services, "request_json"))

    def test_localized_search_and_bounded_area(self):
        self.upstream.return_value = {"features": [{"geometry": {"coordinates": [12.1, 50.25]},
            "properties": {"osm_type": "W", "osm_id": 88, "name": "Stadtpark", "osm_key": "leisure",
                           "osm_value": "park", "street": "Am Park", "city": "Jena"}}]}
        response = self.web.get("/api/geo/search", params={"q": "Stadtpark", "lat": 50.25, "lon": 12.1})
        self.assertEqual(response.json()["items"][0], {"title": "Stadtpark", "address": "Am Park, Jena",
            "lat": 50.25, "lon": 12.1, "category": "Park", "osm_type": "way", "osm_id": 88})
        self.assertIn("lang=de", self.upstream.call_args.args[1])
        bounds = {"west": 11, "east": 11.1, "south": 50, "north": 50.1}
        self.assertEqual(self.web.get("/api/geo/nearby", params={**bounds, "east": 30}).status_code, 422)
        self.assertEqual(self.web.get("/api/geo/nearby", params={**bounds, "category": "fremd"}).status_code, 422)
        self.assertEqual(self.upstream.call_count, 1)
        self.upstream.return_value = {"elements": [{"type": "relation", "id": 30, "center": {"lat": 50, "lon": 11},
                                                    "tags": {"leisure": "park", "name": "Park"}}]}
        self.assertEqual(self.web.get("/api/geo/nearby", params={**bounds, "category": "Park"}).json()["items"][0]["osm_id"], 30)
        query = parse_qs(self.upstream.call_args.args[2].decode())["data"][0]
        self.assertIn('nwr["leisure"="park"]', query)
        self.assertNotIn("tourism", query)

    def make_visit(self, title, coord):
        place = {"title": title}
        if coord is not None:
            place.update(lat=coord, lon=8)
        response = self.web.post(self.path + "/visits", json={"place": place})
        response.raise_for_status()
        return response.json()

    def test_public_nearby_outage_uses_only_visible_photon_results(self):
        def fallback(service, url, *args, **kwargs):
            if service == "OVERPASS":
                raise HTTPException(503, "Offline")
            params = parse_qs(urlsplit(url).query)
            self.assertEqual(params["include"], ["osm.leisure.park"])
            return {"features": [{"properties": {"osm_id": i, "osm_type": "W", "name": str(i)},
                                  "geometry": {"coordinates": [x, 50.1]}} for i, x in [(1, 11), (2, 15)]]}
        self.upstream.side_effect = fallback
        bounds = {"west": 10.9, "east": 11.1, "south": 50, "north": 50.2, "category": "Park"}
        result = self.web.get("/api/geo/nearby", params=bounds).json()
        self.assertEqual(result["source"], "photon")
        self.assertEqual([p["osm_id"] for p in result["items"]], [1])
        self.upstream.reset_mock()
        with patch.dict(os.environ, {"RR_OVERPASS_URL": "http://private.example/api/interpreter"}):
            self.assertEqual(self.web.get("/api/geo/nearby", params=bounds).status_code, 503)
        self.upstream.assert_called_once()

    def road(self, visits, calculate):
        return self.web.post(self.path + "/road-route", json={"visit_ids": [v["id"] for v in visits],
                                                               "calculate": calculate})

    @staticmethod
    def fake_osrm(_service, url):
        coords = [list(map(float, c.split(","))) for c in urlsplit(url).path.split("/")[-1].split(";")]
        if any(pt[1] == 47 for pt in coords):
            return {"code": "NoSegment"}
        return {"code": "Ok", "routes": [{"legs": [{"distance": 1200, "duration": 90,
                "steps": [{"geometry": {"coordinates": [a, b]}}]} for a, b in zip(coords, coords[1:])]}]}

    def test_road_geometry_partial_cache_filter_and_coordinate_change(self):
        visits = [self.make_visit(str(i), lat) for i, lat in enumerate([50, 51, 52, 47, None, 54])]
        self.upstream.side_effect = self.fake_osrm
        initial = self.road(visits, False).json()
        self.assertEqual(initial["legs"][0]["status"], "not_calculated")
        self.upstream.assert_not_called()
        result = self.road(visits, True).json()
        self.assertFalse(result["complete"])
        self.assertEqual(result["distance_m"], 2400)
        self.assertEqual(result["duration_s"], 180)
        self.assertEqual(result["legs"][0]["geometry"], [[50, 8], [51, 8]])
        self.assertEqual([leg["status"] for leg in result["legs"]],
                         ["ok", "ok", "unavailable", "missing_coordinates", "missing_coordinates"])
        self.upstream.reset_mock()
        self.upstream.side_effect = HTTPException(503, "Offline")
        cached = self.road(visits[:3], True).json()
        self.assertTrue(cached["complete"])
        self.upstream.assert_not_called()
        self.assertFalse(self.road(list(reversed(visits[:3])), False).json()["complete"])
        self.web.patch(self.path + "/places/" + str(visits[0]["place_id"]), json={"lon": 8.5}).raise_for_status()
        self.assertEqual([l["status"] for l in self.road(visits[:3], True).json()["legs"]], ["unavailable", "ok"])
        self.upstream.assert_called_once()
        foreign = self.web.post("/api/trips", json={"name": "Andere Reise"}).json()["id"]
        self.assertEqual(self.web.post(f"/api/trips/{foreign}/road-route",
                                       json={"visit_ids": [visits[0]["id"]]}).status_code, 404)

    def test_two_visits_at_same_place_do_not_require_routing(self):
        first = self.make_visit("Campingplatz", 50)
        second = self.web.post(self.path + "/visits", json={"place_id": first["place_id"]}).json()
        result = self.road([first, second], True).json()
        self.assertEqual((result["complete"], result["distance_m"], result["duration_s"]), (True, 0, 0))
        self.upstream.assert_not_called()
