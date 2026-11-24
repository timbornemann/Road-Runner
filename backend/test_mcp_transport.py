"""Check the optional HTTP entry point on the same FastAPI app as the browser."""

import os
import tempfile
import unittest
from unittest.mock import patch

import httpx2
from fastapi.testclient import TestClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from .app import app


class MCPTransportTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "RR_DATA_DIR": directory, "RR_MCP_ENABLED": "", "RR_MCP_READ_ONLY": "", "RR_MCP_TOKEN": "",
        }))

    def test_disabled_and_missing_token(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/integrations/mcp").json(), {
                "enabled": False, "read_only": False, "revision": None,
            })
            for url in ("/mcp", "/mcp/"):
                self.assertEqual(client.get(url).status_code, 404)
                self.assertEqual(client.post(url, json={}).status_code, 404)
            self.assertEqual(client.get("/api/health").status_code, 200)
        os.environ["RR_MCP_ENABLED"] = "true"
        with self.assertRaisesRegex(RuntimeError, "RR_MCP_TOKEN"), TestClient(app):
            pass

    def test_bearer_and_origin_checked_before_sdk_handshake(self):
        token = "token-for-disposable-test-data"
        os.environ.update(RR_MCP_ENABLED="true", RR_MCP_READ_ONLY="true", RR_MCP_TOKEN=token)
        address = "http://192.168.1.20:8080"
        with TestClient(app, base_url=address, follow_redirects=False) as client:
            hello = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "Test", "version": "1"},
            }}
            for method in ("GET", "POST", "DELETE"):
                response = client.request(method, "/mcp")
                self.assertEqual(response.status_code, 401)
                self.assertIn("Bearer", response.headers["WWW-Authenticate"])
            headers = {"Authorization": "Bearer wrong", "Accept": "application/json, text/event-stream"}
            self.assertEqual(client.post("/mcp", headers=headers, json=hello).status_code, 401)
            headers["Authorization"] = f"Bearer {token}"
            self.assertEqual(client.post("/mcp", headers={**headers, "Origin": "http://elsewhere.invalid"},
                                         json=hello).status_code, 403)
            self.assertEqual(client.post("/mcp", headers={**headers, "Host": "elsewhere.invalid",
                                         "Origin": "http://elsewhere.invalid"}, json=hello).status_code, 403)
            for url, origin in (("/mcp", {}), ("/mcp/", {"Origin": address})):
                response = client.post(url, headers={**headers, **origin}, json=hello)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["result"]["serverInfo"]["name"], "Road-Runner")
            self.assertTrue(app.state.mcp_read_only)
            self.assertIsNotNone(app.state.mcp_observer)

        self.assertIsNone(app.state.mcp_observer)


class MCPClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_client_sees_browser_data_and_respects_read_only(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "RR_DATA_DIR": directory, "RR_MCP_ENABLED": "true", "RR_MCP_TOKEN": "test-credential",
        }))
        for read_only in (False, True):
            os.environ["RR_MCP_READ_ONLY"] = str(read_only)
            async with app.router.lifespan_context(app), httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app), base_url="http://localhost",
                headers={"Authorization": "Bearer test-credential"},
            ) as http:
                async with streamable_http_client("http://localhost/mcp", http_client=http) as channels:
                    async with ClientSession(*channels) as client:
                        await client.initialize()
                        names = {t.name for t in (await client.list_tools()).tools}
                        self.assertIn("list_trips", names)
                        self.assertEqual("create_trip" in names, not read_only)
                        self.assertIn("search_notebook", names)
                        self.assertEqual("update_notebook_note" in names, not read_only)
                        self.assertIn("search_places", names)
                        self.assertEqual("create_visit" in names, not read_only)
                        status = (await http.get("/api/integrations/mcp")).json()
                        self.assertEqual(set(status), {"enabled", "read_only", "revision"})
                        self.assertTrue(status["enabled"])
                        self.assertEqual(status["read_only"], read_only)
                        arguments = {"trip": {"name": "MCP-Reise"}}
                        result = await client.call_tool("create_trip", arguments)
                        self.assertEqual(result.is_error, read_only)
                        revision = (await http.get("/api/integrations/mcp")).json()["revision"]
                        self.assertEqual(revision == status["revision"], read_only)
                        trips = await client.call_tool("list_trips", {})
                        self.assertFalse(trips.is_error)
                        self.assertIn("MCP-Reise", trips.content[0].text)
                browser_trips = (await http.get("/api/trips")).json()
                self.assertEqual(sum(t["name"] == "MCP-Reise" for t in browser_trips), 1)
