"""Authenticated read-only workspace. No directory or catch-all file server."""
import argparse
import getpass
import json
import os
from pathlib import Path

from flask import Flask, Response, abort, g, jsonify, render_template, request, send_file, session
from waitress import serve
from werkzeug.security import check_password_hash, generate_password_hash

from .registry import GROUPS, PAGES, SHOWCASE

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = {"activity", "closed", "equity", "pnl", "pnl_series", "positions", "summary"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data: https://polymarket-upload.s3.us-east-2.amazonaws.com; "
       "connect-src 'self' https://gamma-api.polymarket.com https://data-api.polymarket.com "
       "https://clob.polymarket.com https://polygon.drpc.org https://1rpc.io https://polygon-bor-rpc.publicnode.com; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


def create_app(accounts, data_dir, development=False):
    app = Flask(__name__, static_folder=None)
    app.secret_key = os.urandom(32)
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict",
                      SESSION_COOKIE_SECURE=not development, SESSION_COOKIE_NAME="kb_workspace")
    pages = (*PAGES, SHOWCASE) if development else PAGES
    assets = {"brand.css", "brand.js", "terminal.js", "gaussian.svg", "favicon.png"}
    page_assets = {}
    for page in pages:
        for asset in (*page.styles, *page.scripts):
            page_assets.setdefault(asset, set()).add(page.access)
    dummy_hash = generate_password_hash(os.urandom(32).hex())

    @app.before_request
    def authenticate():
        account = accounts.get(session.get("account"))
        if account:
            g.permissions = account["permissions"]
            return
        auth = request.authorization
        if auth and auth.type == "basic":
            account = accounts.get(auth.username)
            if check_password_hash(account["hash"] if account else dummy_hash, auth.password or "") and account:
                session["account"] = auth.username
                g.permissions = account["permissions"]
                return
        return Response("Workspace sign-in required.", 401, {"WWW-Authenticate": 'Basic realm="KB Capital", charset="UTF-8"'})

    @app.after_request
    def protect(response):
        response.headers.update({"Cache-Control": "private, no-store", "Content-Security-Policy": CSP,
                                 "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
                                 "X-Robots-Tag": "noindex, nofollow"})
        return response

    def require(permission):
        if permission not in g.permissions:
            abort(403)

    def visible_pages():
        return [p for p in pages if p.access in g.permissions]

    def show(page):
        require(page.access)
        return render_template("pages/" + page.template + ".html", page=page,
                               pages=visible_pages(), groups=GROUPS)

    for page in pages:
        app.add_url_rule(page.route, page.template, lambda page=page: show(page))

    @app.get("/workspace-search")
    def search():
        query = request.args.get("q", "").strip().casefold()
        return jsonify([{"label": p.label, "category": p.category, "route": p.route}
                        for p in visible_pages() if query in (p.label + " " + p.category).casefold()])

    @app.get("/data/<name>.json")
    def snapshot(name):
        require("fund:read")
        if name not in SNAPSHOTS or not (data_dir / (name + ".json")).is_file():
            abort(404)
        return send_file(data_dir / (name + ".json"), mimetype="application/json")

    @app.get("/workspace.css")
    def shell_styles():
        css = render_template("tokens.css") + render_template("workspace.css", mobile_width=800)
        return Response(css, mimetype="text/css")

    @app.get("/<path:name>")
    def asset(name):
        if name not in assets:
            if name not in page_assets:
                abort(404)
            if page_assets[name].isdisjoint(g.permissions):
                abort(403)
        return send_file(ROOT / name)

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="Enable the component showcase and historical demo snapshots")
    parser.add_argument("--create-user", metavar="NAME", help="Create a new private account file")
    parser.add_argument("--port", type=int, default=8926)
    args = parser.parse_args()
    account_path = Path(os.environ["KB_ACCOUNTS"]).expanduser().resolve()
    if account_path.is_relative_to(ROOT):
        parser.error("KB_ACCOUNTS must be outside the checkout")
    if args.create_user:
        password = getpass.getpass("Workspace password: ")
        if len(password) < 12:
            parser.error("Use at least 12 characters")
        with os.fdopen(os.open(account_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w") as f:
            json.dump({args.create_user: {"hash": generate_password_hash(password), "permissions": ["fund:read"]}}, f)
        return
    data_dir = Path(os.environ["OUT_DIR"]).resolve() if "OUT_DIR" in os.environ else ROOT / "data"
    if not args.dev and data_dir.is_relative_to(ROOT):
        parser.error("Set OUT_DIR to private storage outside the checkout")
    serve(create_app(json.loads(account_path.read_text()), data_dir, args.dev), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
