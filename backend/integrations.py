"""Public connection settings for the web UI. Credentials stay on the server."""

from uuid import uuid4

from fastapi import APIRouter, Request, Response


router = APIRouter()
instance = uuid4().hex


@router.get("/api/integrations/mcp")
async def mcp_status(request: Request, response: Response):
    state = request.app.state
    observer = state.mcp_observer
    revision = None
    if observer is not None:
        # On the same idle connection this counter changes when another connection commits.
        revision = f"{instance}:{observer.execute('PRAGMA data_version').fetchone()[0]}"
    response.headers["Cache-Control"] = "no-store"
    return {"enabled": state.mcp_enabled, "read_only": state.mcp_read_only, "revision": revision}
