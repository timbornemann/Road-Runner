"""Upload the cover and its place atomically. The original lives in the same SQLite snapshot."""

import json
import shutil
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from . import journal_media, places, store


router = APIRouter(prefix="/api/trips/{tid}/places")
MAX_IMAGE = 12 * 1024 * 1024


class ImageTooLarge(MultiPartException):
    pass


@asynccontextmanager
async def upload_form(request):
    if request.headers.get("content-type", "").split(";")[0].lower() != "multipart/form-data":
        raise HTTPException(415, "Das Bild bitte als Multipart-Datei hochladen.")

    async def limited():
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > MAX_IMAGE + 1024 * 1024:
                raise ImageTooLarge("Das Titelbild darf höchstens 12 MiB groß sein.")
            yield chunk

    try:
        form = await MultiPartParser(request.headers, limited(), max_files=1, max_fields=1).parse()
    except ImageTooLarge as exc:
        raise HTTPException(413, exc.message) from exc
    except MultiPartException as exc:
        raise HTTPException(422, "Bild und Ortsdaten konnten nicht gelesen werden.") from exc
    try:
        file = form.get("file")
        if not isinstance(file, UploadFile) or not file.filename or not file.size:
            raise HTTPException(422, "Bitte eine Bilddatei auswählen.")
        if file.size > MAX_IMAGE:
            raise HTTPException(413, "Das Titelbild darf höchstens 12 MiB groß sein.")
        yield file, form.get("payload")
    finally:
        await form.close()


def save(tid, pid, file, payload, with_place):
    filename = file.filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not filename or not filename.isprintable() or len(filename) > 255:
        raise HTTPException(422, "Der Bildname ist ungültig.")
    try:
        mime = journal_media.media_type(file.file.read(4096))
    except HTTPException:
        mime = None
    if not mime or not mime.startswith("image/"):
        raise HTTPException(415, "Für Titelbilder werden JPEG, PNG, GIF und WebP unterstützt.")
    file.file.seek(0)
    with store.session(True) as con:
        if with_place:
            try:
                fields = json.loads(payload)
                if not isinstance(fields, dict):
                    raise ValueError()
            except (TypeError, ValueError) as exc:
                raise HTTPException(422, "Die Ortsdaten müssen als JSON-Objekt übermittelt werden.") from exc
            place, changed = places.save_place(con, tid, fields, pid)
            if not changed:
                return place
            pid = place["id"]
        else:
            places.place_row(con, tid, pid)
        con.execute("""INSERT INTO place_images(place_id,filename,mime_type,size,content)
            VALUES(?,?,?,?,zeroblob(?)) ON CONFLICT(place_id) DO UPDATE SET filename=excluded.filename,
            mime_type=excluded.mime_type,size=excluded.size,content=excluded.content,revision=excluded.revision""",
                    (pid, filename, mime, file.size, file.size))
        with con.blobopen("place_images", "content", pid) as blob:
            shutil.copyfileobj(file.file, blob, journal_media.CHUNK)
        return places.place_row(con, tid, pid)


@router.post("/with-image", status_code=201)
async def create_with_image(tid: int, request: Request):
    async with upload_form(request) as (file, payload):
        return await run_in_threadpool(save, tid, None, file, payload, True)


@router.patch("/{pid}/with-image")
async def edit_with_image(tid: int, pid: int, request: Request):
    async with upload_form(request) as (file, payload):
        return await run_in_threadpool(save, tid, pid, file, payload, True)


@router.put("/{pid}/image")
async def put_image(tid: int, pid: int, request: Request):
    async with upload_form(request) as (file, payload):
        return await run_in_threadpool(save, tid, pid, file, payload, False)


@router.get("/{pid}/image")
def get_image(tid: int, pid: int):
    con = store.connect(check_same_thread=False)
    try:
        con.execute("BEGIN")
        image = places.place_row(con, tid, pid)["image"]
        if not image:
            raise HTTPException(404, "Kein Titelbild gespeichert.")
        return journal_media.SnapshotResponse(con, journal_media.read_blob(con, pid, 0, image["size"], "place_images"),
            media_type=image["mime_type"], headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache",
            "Content-Length": str(image["size"]), "Content-Disposition": "inline; filename*=UTF-8''" + quote(image["filename"], safe="")})
    except BaseException:
        con.close()
        raise


@router.delete("/{pid}/image", status_code=204)
def remove_image(tid: int, pid: int):
    with store.session(True) as con:
        places.place_row(con, tid, pid)
        con.execute("DELETE FROM place_images WHERE place_id=?", (pid,))
    return Response(status_code=204)
