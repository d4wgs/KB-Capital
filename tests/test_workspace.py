import tempfile
import unittest
from pathlib import Path

from workspace.build import ROOT, build
from workspace.registry import PAGES, SHOWCASE


class PublicWorkspaceTests(unittest.TestCase):
    def test_production_output_matches_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            build(out)
            for page in PAGES:
                path = Path(page.route.strip("/")) / "index.html"
                html = (out / path).read_text()
                self.assertEqual(html, (ROOT / path).read_text())
                self.assertIn('id="sidebar"', html)
                self.assertNotIn(SHOWCASE.route, html)
                for asset in (*page.styles, *page.scripts):
                    self.assertTrue((out / asset).is_file())
            self.assertEqual((out / "workspace.css").read_bytes(), (ROOT / "workspace.css").read_bytes())
            self.assertFalse((out / "dev/components/index.html").exists())
            self.assertTrue((out / "data/summary.json").is_file())

    def test_development_showcase(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            build(out, showcase=True)
            self.assertTrue((out / "dev/components/index.html").is_file())
            self.assertIn(SHOWCASE.route, (out / "index.html").read_text())
