import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from mcp.server import MCPServer

from .app import app
from .mcp_places import register_place_tools
from .mcp_tools import get_trip, read_trip_section


class PlaceTools(unittest.IsolatedAsyncioTestCase):
    async def test_repeat_visits_shared_updates_and_read_only(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory, "RR_MCP_ENABLED": "false"}))
        web = self.enterContext(TestClient(app))
        tid = web.post("/api/trips", json={"name": "Zelten"}).json()["id"]
        server = MCPServer("Probe")
        register_place_tools(server)

        async def call(name, **args):
            reply = await server.call_tool(name, {"trip_id": tid, **args})
            return reply.structured_content

        place = await call("create_place", place={"title": "Seeufer", "category": "Campingplatz",
                           "tags": ["Abendsonne"], "description": "Am Wasser", "icon_type": "emoji", "icon": "🏕️"})
        first = await call("create_visit", visit={"place_id": place["id"]})
        second = await call("create_visit", visit={"place_id": place["id"], "date": "2027-05-16"})
        await call("update_visit", visit_id=first["id"], changes={"done": True})
        await call("update_place", place_id=place["id"], changes={"title": "Uferwiese"})
        matches = await call("search_places", query="abendsonne", planned=True)
        self.assertEqual([p["title"] for p in matches["items"]], ["Uferwiese"])
        await call("reorder_visits", visit_ids=[second["id"], first["id"]])
        self.assertEqual([v["done"] for v in (await call("list_visits", place_id=place["id"]))["items"]], [False, True])
        await call("remove_visit", visit_id=first["id"])
        self.assertEqual((await call("read_place", place_id=place["id"]))["icon"], "🏕️")
        self.assertEqual(len(web.get(f"/api/trips/{tid}").json()["visits"]), 1)
        self.assertEqual(get_trip(tid)["counts"]["wishlist"], 0)
        self.assertEqual(read_trip_section(tid, "wishlist")["items"], [])
        limited = MCPServer("Lesemodus")
        register_place_tools(limited, read_only=True)
        self.assertEqual({tool.name for tool in await limited.list_tools()}, {"read_place", "search_places", "list_visits"})
