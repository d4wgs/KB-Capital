# Run the private workspace

Install the locked dependencies with `uv sync --frozen`. Use a directory outside the checkout for account records and snapshots. For a first local review:

```sh
mkdir -p -m 700 ~/.local/state/kb-workspace
export KB_ACCOUNTS="$HOME/.local/state/kb-workspace/accounts.json"
uv run python -m workspace.app --create-user operator
uv run python -m workspace.app --dev --port 8926
```

Visit the localhost port and enter the workspace username and password in the browser prompt. Development mode permits the historical public snapshots and enables the component showcase. The service always requires authentication. The account file contains salted hashes and per-user permission lists. Restart the service after account changes. Browser authentication uses HTTP Basic, followed by an HTTP-only signed session cookie. Closing a session alone does not clear a browser's cached Basic credentials.

## Private operation

Set `OUT_DIR` to a restricted directory outside this repository. Seed it with the existing snapshot files to retain historical equity and performance series. Run the existing collector with the same public wallet and refresh settings, on the private host, every 15 minutes. For example, schedule the equivalent of the following command with the service account's absolute paths and environment:

```sh
WALLET_ADDRESS="$PUBLIC_WALLET" OUT_DIR="$PRIVATE_SNAPSHOT_DIR" uv run python scripts/update.py
```

Start `uv run python -m workspace.app --port 8926` without the development flag. Put a TLS reverse proxy in front of the loopback listener. Proxy all routes, including assets and data, to the application. Disable shared response caching. Do not configure a static web root for this checkout. Secure cookies require HTTPS outside development. Apply password-attempt rate limiting at the proxy. For multiple workers or organizational SSO, integrate the identity provider before rollout. The current host is a single Waitress process.

The previous deployment uses a public repository, GitHub Pages, and a scheduled job that commits snapshots. This branch removes that public write workflow. Publishing this application requires an authenticated server rather than a Pages branch push. At cutover, disable the old Pages origin and public publisher, switch DNS, and verify direct snapshot URLs with and without credentials. Previously published wallet history, Git history and public blockchain activity remain accessible independently. Keep future private financial files outside source control.
