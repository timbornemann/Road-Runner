"""Exercise planning notes across the MCP, browser and export interfaces."""

import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import store
from .app import app
from .mcp_notebook import register_notebook_tools


class NotebookTools(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": directory, "RR_MCP_ENABLED": "false"}))
        self.web = self.enterContext(TestClient(app))
        with store.session(True) as con:
            self.tid = store.create_trip(con, {"name": "Island", "currency": "EUR"})["id"]
        self.mcp = MCPServer("Test")
        register_notebook_tools(self.mcp)
        self.url = f"/api/trips/{self.tid}"

    async def call(self, tool, **args):
        reply = await self.mcp.call_tool(tool, {"trip_id": self.tid, **args})
        return reply.structured_content

    async def test_search_order_pagination_and_browser_revisions(self):
        root = await self.call("create_notebook_topic", topic={"title": "Ringstraße"})
        child = await self.call("create_notebook_topic", topic={"parent_id": root["id"], "title": "Schlafplätze"})
        note = await self.call("create_notebook_note", note={
            "topic_id": child["id"], "title": "Anfragen", "body": "- [ ] Öffnungszeiten für Þakgil klären",
        })
        moved = await self.call("create_notebook_note", note={
            "topic_id": root["id"], "title": "Abreise", "body": "Bettwäsche für Þakgil",
        })
        await self.call("update_notebook_note", note_id=moved["id"], changes={
            "revision": moved["revision"], "topic_id": child["id"], "position": 0,
        })
        page = await self.call("search_notebook", query="ÞAKGIL", kind="note", topic_id=child["id"], limit=1)
        self.assertEqual((page["total"], page["items"][0]["id"], page["next_offset"]), (2, moved["id"], 1))
        page = await self.call("search_notebook", query="ÞAKGIL", kind="note", offset=page["next_offset"])
        item = page["items"][0]
        self.assertEqual((item["id"], item["topic_path"], item["position"]),
                         (note["id"], ["Ringstraße", "Schlafplätze"], 1))
        self.assertNotIn("body", item)
        self.assertIsNone(page["next_offset"])
        await self.call("update_notebook_topic", topic_id=child["id"], changes={"parent_id": None, "position": 0})
        page = await self.call("search_notebook", topic_id=child["id"])
        self.assertEqual(page["items"][0]["topic_path"], ["Schlafplätze"])

        uri = self.url + f"/notebook/notes/{note['id']}"
        new_text = "- [x] Öffnungszeiten geklärt\n- [ ] Reservieren"
        stale = self.web.patch(uri, json={"revision": note["revision"], "body": new_text})
        self.assertEqual(stale.status_code, 409, stale.text)
        current_revision = self.web.get(uri).json()["revision"]
        self.assertEqual(current_revision, item["revision"])
        response = self.web.patch(uri, json={"revision": current_revision, "body": new_text})
        self.assertEqual(response.status_code, 200, response.text)
        with self.assertRaisesRegex(ToolError, "inzwischen geändert"):
            await self.call("update_notebook_note", note_id=note["id"], changes={
                "revision": current_revision, "body": "Überholter Entwurf",
            })
        first = await self.call("read_notebook_note", note_id=note["id"], text_limit=6)
        rest = await self.call("read_notebook_note", note_id=note["id"], text_offset=first["next_text_offset"])
        self.assertEqual(first["body"] + rest["body"], new_text)
        self.assertIsNone(rest["next_text_offset"])
        new_text = new_text.replace("[ ]", "[x]")
        await self.call("update_notebook_note", note_id=note["id"], changes={"revision": rest["revision"], "body": new_text})
        self.assertEqual(self.web.get(uri).json()["body"], new_text)

    async def test_area_links_ledger_and_complete_export(self):
        topic = await self.call("create_notebook_topic", topic={"title": "Hochland"})
        note = await self.call("create_notebook_note", note={"topic_id": topic["id"], "title": "Ausrüstung",
                                                             "body": "- [ ] Karte packen"})
        source = {"source_type": "note", "source_id": note["id"]}
        stop = await self.call("create_linked_notebook_target", target={
            **source, "target_type": "stop", "fields": {"title": "Askja", "saved": True},
        })
        purchase = await self.call("create_linked_notebook_target", target={
            **source, "target_type": "purchase", "fields": {"title": "Straßenkarte", "estimated_cost": 15},
        })
        area = await self.call("create_notebook_area", area={"name": "Zentralisland", "stop_ids": [stop["target"]["id"]]})
        detail = await self.call("read_notebook_area", area_id=area["id"])
        self.assertEqual(detail["items"], [{"id": stop["target"]["id"], "title": "Askja"}])
        await self.call("update_notebook_area", area_id=area["id"], changes={"name": "Östliches Hochland"})
        link = await self.call("create_notebook_link", link={**source, "target_type": "area", "target_id": area["id"]})
        page = await self.call("list_notebook_links", kind="area", item_id=area["id"])
        self.assertEqual((page["title"], page["items"][0]["source_title"]), ("Östliches Hochland", "Ausrüstung"))
        page = await self.call("list_notebook_links", kind="note", item_id=note["id"], offset=1, limit=1)
        self.assertEqual((page["total"], page["items"][0]["id"], page["next_offset"]), (3, purchase["link"]["id"], 2))
        exported = self.web.get(self.url + "/export").json()
        self.assertEqual(exported["schema_version"], 4)
        book = exported["notebook"]
        self.assertEqual(book, self.web.get(self.url).json()["notebook"])
        self.assertEqual(book["topics"], [topic])
        self.assertEqual(book["notes"], [{**note, "body": "- [ ] Karte packen", "trip_id": self.tid}])
        self.assertEqual(book["areas"], [{**area, "name": "Östliches Hochland"}])
        self.assertEqual(book["links"], [stop["link"], purchase["link"], link])
        self.assertEqual([(e["id"], e["base_amount"]) for e in exported["expenses"]], [(purchase["target"]["expense_id"], 15)])
        self.assertTrue(exported["stops"][0]["saved"])

        await self.call("delete_notebook_item", kind="link", item_id=link["id"])
        self.assertEqual((await self.call("list_notebook_links", kind="area", item_id=area["id"]))["total"], 0)
        self.assertEqual((await self.call("read_notebook_area", area_id=area["id"]))["name"], "Östliches Hochland")
        with self.assertRaises(ToolError):
            await self.call("delete_notebook_item", kind="note", item_id=note["id"])
        await self.call("delete_notebook_item", kind="note", item_id=note["id"], revision=note["revision"])
        remaining = self.web.get(self.url).json()
        self.assertEqual(remaining["notebook"]["links"], [])
        self.assertEqual(remaining["purchases"], exported["purchases"])

    async def test_read_only_catalog_and_trip_boundaries(self):
        other = self.web.post("/api/trips", json={"name": "Nebenreise"}).json()["id"]
        topic = await self.call("create_notebook_topic", topic={"title": "Nur auf Island"})
        with self.assertRaises(ToolError):
            await self.call("create_linked_notebook_target", trip_id=other, target={
                "source_type": "topic", "source_id": topic["id"], "target_type": "purchase",
                "fields": {"title": "Falsche Reise", "estimated_cost": 20},
            })
        trip = self.web.get(f"/api/trips/{other}").json()
        self.assertEqual((trip["purchases"], trip["expenses"]), ([], []))
        reader = MCPServer("Lesen")
        register_notebook_tools(reader, read_only=True)
        tools = await reader.list_tools()
        self.assertEqual({tool.name for tool in tools}, {
            "search_notebook", "read_notebook_note", "read_notebook_area", "list_notebook_links",
        })
        self.assertTrue(all(tool.annotations.read_only_hint for tool in tools))
        with self.assertRaises(ToolError):
            await reader.call_tool("create_notebook_topic", {"trip_id": self.tid, "topic": {"title": "Unzulässig"}})
        result = await reader.call_tool("search_notebook", {"trip_id": other})
        self.assertEqual(result.structured_content["items"], [])
