# Public workspace

KB Capital serves static HTML, CSS, JavaScript and public portfolio snapshots from GitHub Pages. Visitors can open any of the four routes directly without an account.

## Development

Install the locked template tooling with `uv sync --frozen`. Run `uv run python -m workspace.build --preview` and open http://127.0.0.1:8926/. The preview renders into a temporary directory, includes the component showcase at `/dev/components/`, and serves public assets and snapshot JSON. Restart the preview after editing a template or asset.

## Publishing

Run `uv run python -m workspace.build` after changing the templates or navigation registry. Commit the regenerated route HTML and workspace.css together with the source changes. Run `uv run python -m unittest discover -s tests` before release. GitHub Pages serves these files directly from main, so the production host requires no Python runtime.

The existing scheduled workflow updates the public data in `data/` using the public wallet address. Historical and live information continues to use the existing snapshot collector and read-only Polymarket integrations. Keep private research, signing keys, API credentials and privileged execution endpoints outside this public repository and static site.
