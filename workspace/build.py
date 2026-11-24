"""Render the public workspace for GitHub Pages, or serve an isolated local preview."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from .registry import GROUPS, PAGES, SHOWCASE

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "workspace/templates"


def build(destination, showcase=False):
    env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape("html"),
                      undefined=StrictUndefined, keep_trailing_newline=True)
    pages = (*PAGES, SHOWCASE) if showcase else PAGES
    # Static hosting has no authorization boundary. Reject private entries at build time.
    if any(page.access != "public" for page in pages):
        raise ValueError("Only public pages may be rendered into the static workspace")
    for page in pages:
        target = destination / page.route.strip("/") / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        html = env.get_template("pages/" + page.template + ".html").render(page=page, pages=pages, groups=GROUPS)
        target.write_text(html, encoding="utf-8")
    css = env.get_template("tokens.css").render() + env.get_template("workspace.css").render(mobile_width=800)
    (destination / "workspace.css").write_text(css, encoding="utf-8")
    if destination != ROOT:
        assets = {"brand.css", "brand.js", "terminal.js", "gaussian.svg", "gaussian.js", "favicon.png"}
        for page in pages:
            assets.update((*page.styles, *page.scripts))
        for asset in [*(ROOT / name for name in assets), *(ROOT / "data").glob("*.json")]:
            output = destination / asset.relative_to(ROOT)
            output.parent.mkdir(parents=True, exist_ok=True)
            copy2(asset, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true", help="Serve a temporary build including the component showcase")
    parser.add_argument("--port", type=int, default=8926)
    args = parser.parse_args()
    if not args.preview:
        build(ROOT)
        return
    with TemporaryDirectory(prefix="kb-public-") as folder:
        build(Path(folder), showcase=True)
        with ThreadingHTTPServer(("127.0.0.1", args.port), partial(SimpleHTTPRequestHandler, directory=folder)) as server:
            server.serve_forever()


if __name__ == "__main__":
    main()
