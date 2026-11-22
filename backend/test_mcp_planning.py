"""Check the agent's planning view against the trip's stored route and shared ledger."""

import os
import tempfile
import unittest
from unittest.mock import patch

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import store
from .mcp_tools import register_planning_tools


class PlanningTools(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        path = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RR_DATA_DIR": path}))
        store.initialize()
        with store.session(True) as con:
            self.tid = store.create_trip(con, {"name": "Lofoten", "budget": 100, "currency": "EUR"})["id"]
        self.server = MCPServer("Test")
        register_planning_tools(self.server)

    async def call(self, tool, **args):
        reply = await self.server.call_tool(tool, {"trip_id": self.tid, **args})
        return reply.structured_content

    async def test_active_itinerary_selection_and_order(self):
        arrival = (await self.call("create_stage", name="Anreise"))["id"]
        coast = (await self.call("create_stage", name="Lofoten"))["id"]
        sea = (await self.call("create_variant", stage_id=coast, name="Küste"))["id"]
        peak = (await self.call("create_variant", stage_id=coast, name="Gebirge"))["id"]
        stops = []
        for fields in [{"title": "Camping", "kind": "sleep"}, {"title": "Losfahren", "stage_id": arrival},
                       {"title": "Fähre", "date": "2027-07-02", "stage_id": coast},
                       {"title": "Strand", "stage_id": coast, "variant_id": sea},
                       {"title": "Pass", "stage_id": coast, "variant_id": peak}, {"title": "Idee", "saved": True}]:
            stops.append((await self.call("create_stop", stop=fields))["id"])

        async def route():
            page = await self.call("read_trip_section", section="itinerary")
            return [item["title"] for item in page["items"]]

        self.assertEqual(await route(), ["Losfahren", "Fähre", "Strand", "Camping"])
        await self.call("reorder_stages", stage_ids=[coast, arrival])
        await self.call("reorder_stops", stop_ids=list(reversed(stops)))
        await self.call("activate_variant", stage_id=coast, variant_id=peak)
        self.assertEqual(await route(), ["Pass", "Fähre", "Losfahren", "Camping"])
        day = await self.call("read_trip_section", section="itinerary", date="2027-07-02")
        self.assertEqual([item["title"] for item in day["items"]], ["Fähre"])
        overview = await self.call("get_trip")
        self.assertEqual((overview["next_stop"]["title"], overview["sleep_stop"]["title"]), ("Pass", "Camping"))
        self.assertEqual((overview["counts"]["stops"], overview["counts"]["wishlist"]), (6, 1))

    async def test_partial_updates_scoping_and_pagination(self):
        with store.session(True) as con:
            other = store.create_trip(con, {"name": "Andere Reise"})["id"]
        ids = []
        for name in ("Steg", "Kai"):
            stop = await self.call("create_stop", stop={"title": name, "tags": ["Wasser"], "notes": "a" * 15999,
                                                       "date": "2027-07-02"})
            ids.append(stop["id"])
        with self.assertRaisesRegex(ToolError, "nicht gefunden"):
            await self.call("update_stop", trip_id=other, stop_id=ids[0], changes={"title": "Falsch"})
        revised = await self.call("update_stop", stop_id=ids[0], changes={"date": None})
        self.assertIsNone(revised["date"])
        self.assertEqual((revised["title"], revised["tags"]), ("Steg", ["Wasser"]))
        first = await self.call("read_trip_section", section="stops", tag="wasser")
        self.assertEqual((len(first["items"]), first["total"], first["next_offset"]), (1, 2, 1))
        second = await self.call("read_trip_section", section="stops", tag="wasser", offset=first["next_offset"])
        self.assertEqual(second["items"][0]["id"], ids[1])
        self.assertIsNone(second["next_offset"])

    async def test_overview_uses_linked_expenses_in_base_currency(self):
        with store.session(True) as con:
            ferry = store.upsert(con, self.tid, "mobility", {"title": "Fähre", "kind": "ferry",
                                 "estimated_cost": 800, "currency": "NOK", "exchange_rate": 0.1})
            store.upsert(con, self.tid, "expenses", {"title": "Brot", "amount": 2.31})
        budget = (await self.call("get_trip"))["budget"]
        self.assertEqual(budget, {"currency": "EUR", "paid": 2.31, "planned": 80.0, "available": 17.69})
        with store.session(True) as con:
            store.upsert(con, self.tid, "expenses", {"status": "paid", "amount": 740}, ferry["expense_id"])
        self.assertEqual((await self.call("get_trip"))["budget"]["available"], 23.69)
