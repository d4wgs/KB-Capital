import unittest
from pathlib import Path
from werkzeug.security import generate_password_hash
from workspace.app import create_app
from workspace.registry import PAGES


class WorkspaceAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        hashed = generate_password_hash("example")
        cls.accounts = {name: {"hash": hashed, "permissions": scopes} for name, scopes in
                        [("operator", ["fund:read"]), ("guest", [])]}
        cls.root = Path(__file__).resolve().parents[1] / "data"

    def client(self, development=False):
        return create_app(self.accounts, self.root, development).test_client()

    def test_direct_access(self):
        client = self.client()
        for path in [p.route for p in PAGES] + ["/data/summary.json", "/workspace-search", "/allocation/view.js"]:
            self.assertEqual(client.get(path).status_code, 401)
        self.assertEqual(client.get("/", auth=("operator", "wrong")).status_code, 401)
        client.get("/", auth=("guest", "example"))
        for path in [p.route for p in PAGES] + ["/data/summary.json", "/allocation/view.js"]:
            self.assertEqual(client.get(path).status_code, 403)
        self.assertEqual(client.get("/workspace-search").json, [])

    def test_routes_and_showcase(self):
        client = self.client()
        client.get("/", auth=("operator", "example"))
        for page in PAGES:
            html = client.get(page.route)
            self.assertEqual(html.status_code, 200)
            self.assertIn(b'id="sidebar"', html.data)
        self.assertEqual(client.get("/workspace-search?q=track").json[0]["route"], "/predictions/")
        for path in ["/dev/components/", "/.envrc", "/.git/config", "/data/accounts.json"]:
            self.assertEqual(client.get(path).status_code, 404)
        with client.get("/data/summary.json") as snapshot:
            self.assertEqual(snapshot.status_code, 200)
            self.assertIn("no-store", snapshot.headers["Cache-Control"])
        self.assertEqual(self.client(True).get("/dev/components/", auth=("operator", "example")).status_code, 200)
