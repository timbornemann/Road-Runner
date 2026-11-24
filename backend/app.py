"""Road Runner's trip-scoped JSON API and single-origin web app."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from . import geo_services, integrations, journal, journal_media, models, notebook, place_images, places, stages, store
from .mcp_server import MCPRoute, mcp_lifespan


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    async with mcp_lifespan(app):
        yield


app = FastAPI(title="Road Runner", version="1.2.0", lifespan=lifespan)
EXPORT_SCHEMA_VERSION = 5

for mcp_path in ("/mcp", "/mcp/"):
    app.add_route(mcp_path, MCPRoute(), include_in_schema=False)


@app.exception_handler(RequestValidationError)
async def invalid_request(request, error):
    return JSONResponse({"detail": models.validation_message(error.errors())}, status_code=422)


@app.get("/api/health")
def health():
    with store.session() as con:
        version = con.execute("PRAGMA user_version").fetchone()[0]
    return {"status": "ok", "schema_version": version}


@app.get("/api/trips")
def list_trips():
    with store.session() as con:
        return store.trips(con)


@app.post("/api/trips", status_code=201)
def create_trip(body: models.Trip):
    with store.session(True) as con:
        return store.create_trip(con, body.model_dump())


@app.get("/api/trips/{tid}")
def get_trip(tid: int):
    with store.session() as con:
        return store.aggregate(con, tid)


@app.patch("/api/trips/{tid}")
def edit_trip(tid: int, body: dict = Body(...)):
    with store.session(True) as con:
        return store.edit_trip(con, tid, body)


@app.delete("/api/trips/{tid}", status_code=204)
def delete_trip(tid: int):
    with store.session(True) as con:
        store.trip(con, tid)
        con.execute("DELETE FROM trips WHERE id=?", (tid,))
    return Response(status_code=204)


@app.get("/api/trips/{tid}/export")
def export_trip(tid: int):
    return journal_media.export_response(tid, EXPORT_SCHEMA_VERSION)


app.include_router(stages.router)
app.include_router(journal.router)
app.include_router(notebook.router)
app.include_router(geo_services.router)
app.include_router(place_images.router)
app.include_router(places.router)
app.include_router(integrations.router)


@app.put("/api/trips/{tid}/stops/order")
def order_stops(tid: int, body: models.Order):
    with store.session(True) as con:
        store.trip(con, tid)
        stops = {s["id"]: s for s in store.records(con, tid, "stops")}
        if len(body.ids) != len(stops) or set(body.ids) != set(stops):
            raise HTTPException(409, "Die Reihenfolge muss alle aktuellen Stopps genau einmal enthalten.")
        store.write_stop_order(con, sorted((stops[sid] for sid in body.ids), key=lambda s: s["saved"]))
        return store.records(con, tid, "stops")


@app.post("/api/trips/{tid}/shopping/checkout")
def checkout(tid: int, body: models.Checkout):
    with store.session(True) as con:
        return store.checkout(con, tid, body)


@app.post("/api/trips/{tid}/pantry/{rid}/consume")
def consume(tid: int, rid: int, body: models.Consume):
    with store.session(True) as con:
        item = store.record(con, tid, "pantry", rid)
        rest = store.dec(item["quantity"]) - body.quantity
        if rest < 0:
            raise HTTPException(409, "Die Verbrauchsmenge übersteigt den vorhandenen Vorrat.")
        return store.put(con, tid, "pantry", {**item, "quantity": float(rest)})


@app.get("/api/trips/{tid}/{group}")
def list_items(tid: int, group: str):
    if group not in store.COLLECTIONS:
        raise HTTPException(404, "Bereich nicht gefunden.")
    with store.session() as con:
        store.trip(con, tid)
        return store.records(con, tid, group)


@app.post("/api/trips/{tid}/{group}", status_code=201)
def create_item(tid: int, group: str, body: dict = Body(...)):
    with store.session(True) as con:
        return store.upsert(con, tid, group, body)


@app.patch("/api/trips/{tid}/{group}/{rid}")
def edit_item(tid: int, group: str, rid: int, body: dict = Body(...)):
    with store.session(True) as con:
        return store.upsert(con, tid, group, body, rid)


@app.delete("/api/trips/{tid}/{group}/{rid}", status_code=204)
def delete_item(tid: int, group: str, rid: int):
    with store.session(True) as con:
        store.remove(con, tid, group, rid)
    return Response(status_code=204)


@app.get("/{path:path}", include_in_schema=False)
def web_app(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "API-Endpunkt nicht gefunden.")
    root = Path(os.getenv("RR_STATIC_DIR", "frontend/dist")).resolve()
    candidate = (root / path).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(404, "Datei nicht gefunden.")
    if candidate.is_file():
        return FileResponse(candidate)
    index = root / "index.html"
    if not Path(path).suffix and index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "Webdatei nicht gefunden.")
