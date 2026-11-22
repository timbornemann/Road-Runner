"""Store original media in the trip database and stream downloads from a consistent snapshot."""

import base64
import datetime as dt
import hashlib
import json
import re
import shutil
import tempfile
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import store


router = APIRouter()
MAX_SIZE = 100 * 1024 * 1024
CHUNK = 3 * 65536  # Multiple of three so adjacent base64 blocks have no internal padding.
MEDIA_PATH = "/api/trips/{tid}/journal/{eid}/media"


def describe(tid, row):
    path = MEDIA_PATH.format(tid=tid, eid=row["entry_id"])
    return {**{k: row[k] for k in ("id", "filename", "mime_type", "size")}, "url": f"{path}/{row['id']}"}


def media_type(header):
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in header:
        return "video/webm"
    if header[4:8] == b"ftyp":
        size = int.from_bytes(header[:4], "big")
        brands = {header[8:12], *(header[i:i + 4] for i in range(16, min(len(header), size), 4))}
        if b"qt  " in brands:
            return "video/quicktime"
        if brands.intersection({b"isom", b"iso2", b"iso3", b"iso4", b"iso5", b"iso6", b"mp41",
                               b"mp42", b"M4V ", b"avc1", b"dash", b"MSNV"}):
            return "video/mp4"
    raise HTTPException(415, "Unterstützt werden JPEG, PNG, GIF, WebP, MP4, MOV und WebM.")


def require_entry(con, tid, eid):
    if not con.execute("SELECT 1 FROM journal_entries WHERE trip_id=? AND id=?", (tid, eid)).fetchone():
        raise HTTPException(404, "Tagebucheintrag nicht gefunden.")


def check_destination(tid, eid=None):
    with store.session() as con:
        if eid is None:
            store.trip(con, tid)
        else:
            require_entry(con, tid, eid)


def save_upload(con, tid, eid, filename, file, size, digest):
    file.seek(0)
    mime_type = media_type(file.read(4096))
    row = con.execute("SELECT id,entry_id,filename,mime_type,size FROM journal_media WHERE entry_id=? AND digest=?",
                      (eid, digest)).fetchone()
    if row:
        return describe(tid, row)
    mid = con.execute("INSERT INTO journal_media(entry_id,filename,mime_type,size,digest,content) "
                      "VALUES(?,?,?,?,?,zeroblob(?))", (eid, filename, mime_type, size, digest, size)).lastrowid
    file.seek(0)
    with con.blobopen("journal_media", "content", mid) as blob:
        shutil.copyfileobj(file, blob, CHUNK)
    return describe(tid, {"id": mid, "entry_id": eid, "filename": filename, "mime_type": mime_type, "size": size})


@asynccontextmanager
async def received_file(request, filename):
    name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name or not name.isprintable():
        raise HTTPException(422, "Bitte eine Datei mit gültigem Namen auswählen.")
    declared_size = request.headers.get("content-length", "")
    if declared_size.isdigit() and int(declared_size) > MAX_SIZE:
        raise HTTPException(413, "Eine Datei darf höchstens 100 MiB groß sein.")
    # Slow network clients do not occupy the SQLite writer lock.
    digest = hashlib.sha256()
    size = 0
    with tempfile.TemporaryFile() as file:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_SIZE:
                raise HTTPException(413, "Eine Datei darf höchstens 100 MiB groß sein.")
            digest.update(chunk)
            await run_in_threadpool(file.write, chunk)
        yield name, file, size, digest.hexdigest()


@router.post(MEDIA_PATH, status_code=201)
async def upload(tid: int, eid: int, request: Request, filename: str = Query(min_length=1, max_length=255)):
    def attach(*media):
        with store.session(True) as con:
            require_entry(con, tid, eid)
            return save_upload(con, tid, eid, *media)

    await run_in_threadpool(check_destination, tid, eid)
    async with received_file(request, filename) as media:
        return await run_in_threadpool(attach, *media)


def media_record(con, tid, eid, mid):
    row = con.execute("SELECT m.id,m.filename,m.mime_type,m.size FROM journal_media m "
                      "JOIN journal_entries e ON e.id=m.entry_id WHERE e.trip_id=? AND e.id=? AND m.id=?",
                      (tid, eid, mid)).fetchone()
    if not row:
        raise HTTPException(404, "Anhang nicht gefunden.")
    return row


@router.delete(MEDIA_PATH + "/{mid}", status_code=204)
def delete_media(tid: int, eid: int, mid: int):
    with store.session(True) as con:
        media_record(con, tid, eid, mid)
        con.execute("DELETE FROM journal_media WHERE id=?", (mid,))
    return Response(status_code=204)


class SnapshotResponse(StreamingResponse):
    """ASGI may read consecutive chunks on different workers. Release the snapshot on disconnect, too."""

    def __init__(self, con, chunks, **kwargs):
        super().__init__(chunks, **kwargs)
        self.connection = con
        self.chunks = chunks

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.chunks.close()
            self.connection.close()


def read_blob(con, mid, start, count):
    with con.blobopen("journal_media", "content", mid, readonly=True) as blob:
        blob.seek(start)
        while count:
            chunk = blob.read(min(count, CHUNK))
            count -= len(chunk)
            yield chunk


def byte_range(value, size):
    if value is None:
        return 0, size - 1
    match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", value.strip())
    if match:
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last), size - 1) if last else size - 1
            if start <= end:
                return start, end
        elif last and int(last) > 0:
            return max(0, size - int(last)), size - 1
    raise HTTPException(416, "Der angeforderte Dateibereich ist ungültig.", headers={"Content-Range": f"bytes */{size}"})


@router.head(MEDIA_PATH + "/{mid}", include_in_schema=False)
@router.get(MEDIA_PATH + "/{mid}")
def download(tid: int, eid: int, mid: int, request: Request):
    con = store.connect(check_same_thread=False)
    try:
        con.execute("BEGIN")
        row = media_record(con, tid, eid, mid)
        requested = request.headers.get("range")
        start, end = byte_range(requested, row["size"])
        length = end - start + 1
        headers = {
            "Accept-Ranges": "bytes", "Content-Length": str(length), "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename*=UTF-8''" + quote(row["filename"], safe=""),
        }
        if requested:
            headers["Content-Range"] = f"bytes {start}-{end}/{row['size']}"
        options = {"status_code": 206 if requested else 200, "media_type": row["mime_type"], "headers": headers}
        if request.method == "HEAD":
            con.close()
            return Response(**options)
        return SnapshotResponse(con, read_blob(con, mid, start, length), **options)
    except BaseException:
        con.close()
        raise


def export_chunks(con, data):
    # The regular aggregate contains only attachment metadata. Append the originals by stable media ID.
    yield json.dumps(data, ensure_ascii=False, separators=(",", ":"))[:-1]
    yield ',"journal_media_content":{'
    first = True
    for note in data["journal_entries"]:
        for media in note["media"]:
            if not first:
                yield ","
            first = False
            yield f'"{media["id"]}":"'
            for chunk in read_blob(con, media["id"], 0, media["size"]):
                yield base64.b64encode(chunk)
            yield '"'
    yield "}}"


def export_response(tid, version):
    con = store.connect(check_same_thread=False)
    try:
        con.execute("BEGIN")
        data = {"schema_version": version, "exported_at": dt.datetime.now(dt.UTC).isoformat(), **store.aggregate(con, tid)}
        copies = con.execute("SELECT c.stop_id,c.source_stop_id,r.trip_id AS source_trip_id FROM favorite_copies c "
                             "JOIN records r ON r.id=c.source_stop_id WHERE c.trip_id=? ORDER BY c.stop_id", (tid,))
        data["favorite_copies"] = [dict(row) for row in copies]
        name = quote(f"{data['trip']['name']}.json", safe="")
        headers = {"Content-Disposition": f"attachment; filename=road-runner-{tid}.json; filename*=UTF-8''{name}"}
        return SnapshotResponse(con, export_chunks(con, data), media_type="application/json", headers=headers)
    except BaseException:
        con.close()
        raise
