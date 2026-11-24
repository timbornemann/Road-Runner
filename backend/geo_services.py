"""User-triggered geocoding, nearby POIs and driving directions for the local map."""

import json
import math
import os
import threading
import time
from collections import OrderedDict
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field

from . import models, store

router = APIRouter()
SERVICES = {
    "PHOTON": "https://photon.komoot.io",
    "OVERPASS": "https://overpass.private.coffee/api/interpreter",
    "OSRM": "https://routing.openstreetmap.de/routed-car",
}
CATEGORIES = {
    "Berg": ("natural", "peak"),
    "Park": ("leisure", "park"),
    "Aussichtspunkt": ("tourism", "viewpoint"),
    "Sehenswürdigkeit": ("tourism", "attraction"),
    "Campingplatz": ("tourism", "camp_site"),
}
NearbyCategory = Literal["Alle", "Berg", "Park", "Aussichtspunkt", "Sehenswürdigkeit", "Campingplatz"]
Latitude = Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)]
_locks = {key: threading.Lock() for key in SERVICES}
_last_request = {}
_cache = {key: OrderedDict() for key in SERVICES}
_overpass_retry_after = {}


def endpoint(service):
    return os.environ.get("RR_" + service + "_URL", SERVICES[service]).rstrip("/")


def request_json(service, url, form=None, *, cache=False):
    # Serialize requests per provider across LAN clients. Recheck the cache inside the lock
    # so simultaneous identical searches consume a single upstream request.
    key = (url, form)
    with _locks[service]:
        entries = _cache[service]
        if cache and key in entries:
            saved_at, value = entries[key]
            if time.monotonic() - saved_at < 900:
                entries.move_to_end(key)
                return value
        if service == "OVERPASS" and time.monotonic() < _overpass_retry_after.get(url, 0):
            raise HTTPException(503, "Die Umgebungssuche ist vorübergehend ausgelastet.")
        delay = _last_request.get(service, 0) + 1.05 - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        _last_request[service] = time.monotonic()
        headers = {"User-Agent": "Road-Runner (+https://github.com/TimBornemann/Road-Runner)", "Accept": "application/json"}
        try:
            req = Request(url, data=form, headers=headers)
            with urlopen(req, timeout=6 if service == "OVERPASS" else 12) as response:
                raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise ValueError("response too large")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError("expected JSON object")
        except HTTPError as exc:
            # OSRM reports unroutable road segments with HTTP 400.
            if service == "OSRM" and exc.code == 400:
                try:
                    result = json.loads(exc.read(8192))
                    if isinstance(result, dict) and result.get("code") in ("NoRoute", "NoSegment", "TooBig"):
                        return result
                except (ValueError, OSError):
                    pass
            if service == "OVERPASS" and (exc.code == 429 or exc.code >= 500):
                _overpass_retry_after[url] = time.monotonic() + 45
            raise HTTPException(503, "Der Kartendienst ist momentan nicht verfügbar. Bitte später erneut versuchen.") from exc
        except (OSError, URLError, ValueError) as exc:
            if service == "OVERPASS":
                _overpass_retry_after[url] = time.monotonic() + 45
            raise HTTPException(503, "Der Kartendienst konnte nicht erreicht oder gelesen werden.") from exc
        if cache:
            entries[key] = (time.monotonic(), value)
            if len(entries) > 64:
                entries.popitem(last=False)
        return value


def poi(tags, osm_type, osm_id, lat, lon, category=None):
    if not isinstance(tags, dict) or not valid_point(lat, lon):
        return None
    mapping = {"N": "node", "W": "way", "R": "relation"}
    kind = mapping.get(osm_type, osm_type) if isinstance(osm_type, str) else None
    if kind not in ("node", "way", "relation") or not isinstance(osm_id, int) or osm_id < 1:
        return None
    street = " ".join(str(v) for v in (tags.get("street") or tags.get("addr:street"),
                                        tags.get("housenumber") or tags.get("addr:housenumber")) if v)
    address = ", ".join(str(v) for v in (street, tags.get("city") or tags.get("addr:city"), tags.get("country")) if v)
    if not category:
        category = next((label for label, (k, v) in CATEGORIES.items() if tags.get(k) == v
                         or (tags.get("osm_key"), tags.get("osm_value")) == (k, v)), "Ort")
    title = tags.get("name:de") or tags.get("name") or street or category
    return {"title": str(title)[:250], "address": address[:500], "lat": lat, "lon": lon, "category": category,
            "osm_type": kind, "osm_id": osm_id}


def valid_point(lat, lon):
    return (isinstance(lat, (float, int)) and isinstance(lon, (float, int))
            and -90 <= lat <= 90 and -180 <= lon <= 180)


def photon_results(params):
    data = request_json("PHOTON", endpoint("PHOTON") + "/api/?" + urlencode(params, doseq=True), cache=True)
    items = []
    if not isinstance(data.get("features"), list):
        raise HTTPException(503, "Die Ortssuche lieferte keine lesbare Trefferliste.")
    for feature in data["features"][:params["limit"]]:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
        if isinstance(props, dict) and isinstance(coords, list) and len(coords) == 2:
            item = poi(props, props.get("osm_type"), props.get("osm_id"), coords[1], coords[0])
            if item:
                items.append(item)
    return items


@router.get("/api/geo/search")
def search(q: Annotated[str, Query(min_length=2, max_length=200)], lat: Latitude | None = None,
           lon: Longitude | None = None):
    if len(q.strip()) < 2 or (lat is None) != (lon is None):
        raise HTTPException(422, "Bitte Suchbegriff oder Kartenmittelpunkt prüfen.")
    params = {"q": q.strip(), "lang": "de", "limit": 15}
    if lat is not None:
        params.update(lat=round(lat, 3), lon=round(lon, 3))
    return {"items": photon_results(params)}


@router.get("/api/geo/nearby")
def nearby(south: Latitude, west: Longitude, north: Latitude, east: Longitude, category: NearbyCategory = "Alle"):
    width = (east - west) % 360
    if not 0 < north - south <= 0.5 or not 0 < width <= 1:
        raise HTTPException(422, "Bitte näher heranzoomen, um diese Umgebung zu erkunden.")
    filters = CATEGORIES.values() if category == "Alle" else [CATEGORIES[category]]
    spans = [(west, east)] if west < east else [(west, 180), (-180, east)]
    queries = "".join(f'nwr["{k}"="{v}"]({south:.5f},{left:.5f},{north:.5f},{right:.5f});'
                      for left, right in spans for k, v in filters)
    query = "[out:json][timeout:9];(" + queries + ");out center 101;"
    overpass = endpoint("OVERPASS")
    try:
        data = request_json("OVERPASS", overpass, urlencode({"data": query}).encode(), cache=True)
        if data.get("remark") or not isinstance(data.get("elements"), list):
            raise HTTPException(503, "Die Umgebungssuche wurde unterbrochen. Bitte einen kleineren Ausschnitt wählen.")
    except HTTPException:
        # Respect deployments that intentionally direct this data to a private endpoint.
        if overpass != SERVICES["OVERPASS"]:
            raise
        items = {}
        categories = ",".join(f"osm.{k}.{v}" for k, v in filters)
        for left, right in spans:
            results = photon_results({"lang": "de", "include": categories, "limit": 101,
                                      "bbox": f"{left:.5f},{south:.5f},{right:.5f},{north:.5f}"})
            for item in results:
                if left <= item["lon"] <= right and south <= item["lat"] <= north:
                    items[item["osm_type"], item["osm_id"]] = item
        return {"items": list(items.values())[:100], "truncated": len(items) > 100, "source": "photon"}
    items = []
    for element in data.get("elements", []):
        if not isinstance(element, dict):
            continue
        pos = element.get("center") or element
        if not isinstance(pos, dict):
            continue
        item = poi(element.get("tags"), element.get("type"), element.get("id"), pos.get("lat"), pos.get("lon"))
        if item:
            items.append(item)
    return {"items": items[:100], "truncated": len(items) > 100, "source": "overpass"}


def migrate(con):
    con.execute("""CREATE TABLE IF NOT EXISTS road_legs (
        trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE, provider TEXT NOT NULL,
        endpoints TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(trip_id,provider,endpoints))""")


class RouteRequest(models.Form):
    visit_ids: list[Annotated[int, Field(gt=0)]] = Field(max_length=2000)
    calculate: bool = False


def coord_key(stop):
    if not valid_point(stop["lat"], stop["lon"]):
        return None
    return f'{stop["lon"]:.6f},{stop["lat"]:.6f}'


def osrm_batch(provider, points):
    path = "/route/v1/driving/" + ";".join(points)
    # A mountain summit must not silently snap to a distant highway.
    params = {"steps": "true", "overview": "false", "geometries": "geojson", "radiuses": ";".join(["300"] * len(points))}
    result = request_json("OSRM", provider + path + "?" + urlencode(params))
    if result.get("code") in ("NoRoute", "NoSegment", "TooBig"):
        if len(points) == 2:
            return [None]
        middle = len(points) // 2
        return osrm_batch(provider, points[:middle + 1]) + osrm_batch(provider, points[middle:])
    routes = result.get("routes") or []
    if not routes or len(routes[0].get("legs", [])) != len(points) - 1:
        raise HTTPException(503, "Der Routingdienst hat keine verwertbare Strecke geliefert.")
    legs = []
    for leg in routes[0]["legs"]:
        line = []
        for step in leg.get("steps", []):
            for coord in (step.get("geometry") or {}).get("coordinates", []):
                if len(coord) == 2 and valid_point(coord[1], coord[0]):
                    point = [coord[1], coord[0]]
                    if not line or point != line[-1]:
                        line.append(point)
        metrics = [leg.get("distance"), leg.get("duration")]
        if not line or not all(isinstance(n, (float, int)) and math.isfinite(n) and n >= 0 for n in metrics):
            legs.append(None)
        else:
            legs.append({"status": "ok", "distance_m": metrics[0], "duration_s": metrics[1], "geometry": line})
    return legs


@router.post("/api/trips/{tid}/road-route")
def road_route(tid: int, body: RouteRequest):
    provider = endpoint("OSRM")
    with store.session() as con:
        store.trip(con, tid)
        stops = {s["id"]: s for s in store.records(con, tid, "stops") if not s["saved"]}
        if any(vid not in stops for vid in body.visit_ids):
            raise HTTPException(404, "Mindestens ein Besuch gehört nicht zur aktuellen Route dieser Reise.")
        points = [coord_key(stops[vid]) for vid in body.visit_ids]
        keys = [(a + ";" + b) if a and b else None for a, b in zip(points, points[1:])]
        known = {}
        for i, key in enumerate(keys):
            if key and points[i] == points[i + 1]:
                stop = stops[body.visit_ids[i]]
                known[key] = {"status": "ok", "distance_m": 0, "duration_s": 0,
                              "geometry": [[stop["lat"], stop["lon"]]]}
        for key in set(keys) - {None} - known.keys():
            row = con.execute("SELECT result FROM road_legs WHERE trip_id=? AND provider=? AND endpoints=?",
                              (tid, provider, key)).fetchone()
            if row:
                known[key] = json.loads(row[0])

    if body.calculate:
        index = 0
        while index < len(keys):
            if not keys[index] or keys[index] in known:
                index += 1
                continue
            end = index + 1
            while end < len(keys) and end - index < 16 and keys[end] and keys[end] not in known:
                end += 1
            try:
                sections = osrm_batch(provider, points[index:end + 1])
            except HTTPException:
                break  # Keep earlier results and show gaps for remaining unavailable spans.
            with store.session(True) as con:
                store.trip(con, tid)
                for key, section in zip(keys[index:end], sections):
                    known[key] = section
                    if section:
                        con.execute("INSERT OR REPLACE INTO road_legs VALUES (?,?,?,?)",
                                    (tid, provider, key, json.dumps(section, separators=(",", ":"))))
            index = end

    legs = []
    for i, key in enumerate(keys):
        status = "missing_coordinates" if key is None else "unavailable" if body.calculate else "not_calculated"
        leg = known.get(key) or {"status": status, "distance_m": None, "duration_s": None, "geometry": []}
        legs.append({"from_id": body.visit_ids[i], "to_id": body.visit_ids[i + 1], **leg})
    return {"legs": legs, "distance_m": sum(l["distance_m"] or 0 for l in legs),
            "duration_s": sum(l["duration_s"] or 0 for l in legs), "complete": all(l["status"] == "ok" for l in legs)}
