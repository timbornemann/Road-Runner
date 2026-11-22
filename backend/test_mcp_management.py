"""Verify the management tools through the MCP SDK against a disposable trip."""

import os
import tempfile
import unittest
from unittest.mock import patch

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import store
from .mcp_management import register_management_tools


class ManagementTools(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        path = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": path}))
        store.initialize()
        with store.session(True) as con:
            self.tid = store.create_trip(con, {"name": "Testfahrt", "currency": "EUR"})["id"]
        self.mcp = MCPServer("Test")
        register_management_tools(self.mcp)

    async def call(self, tool, **args):
        reply = await self.mcp.call_tool(tool, {"trip_id": self.tid, **args})
        return reply.structured_content

    async def test_checkout_retry_consume_and_currency_link(self):
        line = await self.call("save_shopping_item", fields={"name": "Brot", "quantity": 3})
        receipt = {
            "items": [{"id": line["id"], "quantity": 2}],
            "amount": 66, "currency": "NOK", "exchange_rate": 0.09, "request_id": "bon-brot",
        }
        booked = await self.call("checkout_shopping", receipt=receipt)
        self.assertEqual(booked["base_amount"], 5.94)
        self.assertEqual(booked, await self.call("checkout_shopping", receipt=receipt))
        with store.session() as con:
            stock = store.records(con, self.tid, "pantry")[0]
            self.assertEqual(stock["quantity"], 2)
            self.assertEqual(store.record(con, self.tid, "shopping", line["id"])["quantity"], 1)
            self.assertEqual(len(store.records(con, self.tid, "expenses")), 1)
        consumed = await self.call("consume_pantry", record_id=stock["id"], quantity=0.5)
        self.assertEqual(consumed["quantity"], 1.5)

        ferry = await self.call("save_mobility", fields={"title": "Fähre", "kind": "ferry", "estimated_cost": 80})
        cost = await self.call("save_expense", record_id=ferry["expense_id"], fields={
            "amount": 740, "currency": "NOK", "exchange_rate": 0.1, "status": "paid",
        })
        self.assertEqual(cost["base_amount"], 74)
        revised = await self.call("save_mobility", record_id=ferry["id"], fields={"done": True})
        self.assertEqual((revised["title"], revised["kind"], revised["paid"]), ("Fähre", "ferry", True))
        self.assertEqual((revised["estimated_cost"], revised["currency"]), (740, "NOK"))
        with self.assertRaises(ToolError):
            await self.call("save_mobility", record_id=ferry["id"], fields={"expense_id": None})

    async def test_diary_and_cross_trip_favorites(self):
        with store.session(True) as con:
            camp = store.upsert(con, self.tid, "stops", {"title": "Am See", "kind": "sleep"})
            next_trip = store.create_trip(con, {"name": "Nächste Reise"})
        entry = await self.call("save_journal_entry", fields={
            "date": "2027-06-08", "text": "Ein stiller Abend.", "stop_ids": [camp["id"]],
        })
        await self.call("save_journal_entry", entry_id=entry["id"], fields={"title": "Am See"})
        part = await self.call("read_journal_entry", entry_id=entry["id"], text_limit=3)
        self.assertEqual((part["next_text_offset"], part["text"], part["stop_ids"]), (3, "Ein", [camp["id"]]))
        with self.assertRaises(ToolError):
            await self.call("save_journal_entry", trip_id=next_trip["id"], entry_id=entry["id"], fields={"title": "X"})
        await self.call("set_favorite", stop_id=camp["id"])
        matches = await self.mcp.call_tool("list_favorites", {"query": "Testfahrt"})
        self.assertEqual([item["stop_id"] for item in matches.structured_content["items"]], [camp["id"]])
        copied = await self.call("copy_favorite", trip_id=next_trip["id"], stop_id=camp["id"])
        self.assertTrue(copied["saved"])
        self.assertEqual(copied, await self.call("copy_favorite", trip_id=next_trip["id"], stop_id=camp["id"]))

    async def test_read_only_management_catalog(self):
        reader = MCPServer("Lesen")
        register_management_tools(reader, read_only=True)
        tools = await reader.list_tools()
        self.assertEqual({tool.name for tool in tools}, {"list_favorites", "read_journal_entry"})
        self.assertTrue(all(tool.annotations.read_only_hint for tool in tools))
        with self.assertRaises(ToolError):
            await reader.call_tool("save_expense", {"trip_id": self.tid, "fields": {"title": "Buch", "amount": 12}})
