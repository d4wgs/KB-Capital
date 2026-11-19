#!/usr/bin/env python3
"""KB Capital: pull a public Polymarket wallet into static JSON files.

Uses only public, read-only endpoints. No API key and no private key are needed.
The only input is your PUBLIC wallet address (the one shown on your Polymarket
profile), set as the WALLET_ADDRESS variable in the GitHub repo.

Writes to ./data:
  summary.json    headline numbers and metrics
  positions.json  open positions (and resolved ones waiting to be redeemed)
  closed.json     position history (closed / settled)
  activity.json   recent trades and other account activity
  equity.json     one snapshot per run (hourly at most), so history builds over time
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WALLET = os.environ.get("WALLET_ADDRESS", "").strip().lower()
DATA_API = os.environ.get("DATA_API", "https://data-api.polymarket.com/v2").rstrip("/")
RPC_URLS = [
    u.strip()
    for u in os.environ.get(
        "POLYGON_RPC_URLS",
        "https://polygon-rpc.com,https://polygon.drpc.org,https://1rpc.io/matic",
    ).split(",")
    if u.strip()
]
PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"  # Polymarket USD, Polygon
PUSD_DECIMALS = 6

# Hide the newest trades from the public feed for this many hours (0 = show immediately).
# Short-duration strategies can be copied or traded against if posted live.
TRADE_DELAY_HOURS = float(os.environ.get("TRADE_DELAY_HOURS") or "0")

OUT = Path(os.environ.get("OUT_DIR", Path(__file__).resolve().parent.parent / "data"))
MAX_PAGES = 60
EQUITY_MIN_GAP_S = 3300  # at most about one snapshot per hour
EQUITY_MAX_POINTS = 20000


def http_json(url, body=None, retries=4):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json", "User-Agent": "kbcap-fund-site/1.0"}
    if data:
        headers["Content-Type"] = "application/json"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(min(float(e.headers.get("Retry-After", 2)), 30))
            elif 500 <= e.code < 600:
                time.sleep(2 * (attempt + 1))
            else:
                raise
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"request failed: {url}: {last}")


def api(path, **params):
    q = {k: v for k, v in params.items() if v is not None}
    q["user"] = WALLET
    return http_json(f"{DATA_API}{path}?{urllib.parse.urlencode(q)}")


def paged(path, limit=100, max_pages=MAX_PAGES, **params):
    """Follow cursor pagination. Re-sends the same filters on every page, as the docs require."""
    rows, cursor = [], None
    for _ in range(max_pages):
        extra = {"cursor": cursor} if cursor else {"limit": limit}
        res = api(path, **params, **extra)
        rows.extend(res.get("data") or [])
        pg = res.get("pagination") or {}
        cursor = pg.get("next_cursor")
        if not cursor:
            break
    return rows


def num(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def iso(ts):
    """Epoch seconds (or ms) to ISO string; None if unknown."""
    ts = num(ts, 0)
    if ts <= 0:
        return None
    if ts > 1e12:
        ts /= 1000
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cash_balance():
    """pUSD sitting in the wallet (Polymarket's trading cash). Read straight from Polygon."""
    call = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": PUSD, "data": "0x70a08231" + WALLET[2:].rjust(64, "0")}, "latest"],
    }
    for url in RPC_URLS:
        try:
            res = http_json(url, body=call, retries=2)
            if "result" in res:
                return int(res["result"], 16) / 10**PUSD_DECIMALS
        except Exception as e:  # try the next RPC
            print(f"  rpc {url} failed: {e}", file=sys.stderr)
    return None


def slim_position(p):
    return {
        "title": p.get("title"),
        "slug": p.get("slug"),
        "event_slug": p.get("event_slug"),
        "outcome": p.get("outcome"),
        "status": p.get("status"),
        "size": num(p.get("current_size")),
        "total_size": num(p.get("total_size")),
        "avg_price": num(p.get("avg_price")),
        "current_price": p.get("current_price"),
        "cost": num(p.get("entry_cost_usdc")),
        "value": num(p.get("current_value")),
        "realized_pnl": num(p.get("realized_pnl")),
        "unrealized_pnl": num(p.get("unrealized_pnl")),
        "total_pnl": num(p.get("total_pnl")),
        "percent_pnl": p.get("percent_pnl"),
        "end_date": p.get("end_date"),
        "opened": iso(p.get("first_entry_at")),
        "last_activity": iso(p.get("last_event_at")),
        "condition_id": p.get("condition_id"),
        "token_id": p.get("token_id"),
    }


def slim_activity(a):
    return {
        "time": iso(a.get("timestamp")),
        "type": a.get("type"),
        "side": a.get("side"),
        "title": a.get("title"),
        "slug": a.get("slug"),
        "event_slug": a.get("event_slug"),
        "outcome": a.get("outcome"),
        "shares": num(a.get("size")),
        "usdc": num(a.get("usdc_size")),
        "price": a.get("price"),
        "tx": a.get("transaction_hash"),
    }


def pnl_points(interval, fidelity):
    pts = (api("/user-pnl", interval=interval, fidelity=fidelity).get("data") or {}).get("points") or []
    return sorted((int(p["timestamp"]), num(p.get("economic_pnl"))) for p in pts if p.get("timestamp") is not None)


def ts_s(x):
    x = num(x, 0)
    return x / 1000 if x > 1e12 else x


def price_history(token, fallback):
    """Minute prices for the last ~day from the public CLOB API. Falls back to a flat price."""
    try:
        url = "https://clob.polymarket.com/prices-history?" + urllib.parse.urlencode({"market": token, "interval": "1d", "fidelity": 1})
        hist = http_json(url, retries=2).get("history") or []
        pts = sorted((int(h["t"]), num(h["p"])) for h in hist)
        if pts:
            return pts
    except Exception as e:
        print(f"  price history unavailable for a token: {e}", file=sys.stderr)
    return [(0, fallback)] if fallback is not None else []


def minute_pnl(now_ts, activity_raw, positions):
    """Rebuild P&L minute by minute for the last hour from trades + minute prices.

    Polymarket only publishes P&L hourly, so this is computed: for each market touched, shares x price + net cash flow.
    It is used as a *change* over the hour, so small differences from Polymarket's own accounting (fees) don't matter.
    """
    start = int(now_ts) - 3600
    events = {}  # token -> [(ts, shares_delta, cash_delta)]
    by_condition = {}
    for a in sorted(activity_raw, key=lambda a: ts_s(a.get("timestamp"))):
        t, ts = a.get("type"), ts_s(a.get("timestamp"))
        tok = a.get("token_id")
        if t == "TRADE" and tok:
            sh, usd = num(a.get("size")), num(a.get("usdc_size"))
            sign = 1 if a.get("side") == "BUY" else -1
            events.setdefault(tok, []).append((ts, sign * sh, -sign * usd))
            by_condition.setdefault(a.get("condition_id"), set()).add(tok)
        elif t == "REDEEM":
            # Redemption pays out cash and zeroes the shares of that market.
            for tk in by_condition.get(a.get("condition_id"), ()):
                events[tk].append((ts, "ZERO", num(a.get("usdc_size")) if len(by_condition[a.get("condition_id")]) == 1 else 0.0))
    if not events:
        return []

    last_price = {p.get("token_id"): num(p.get("current_price"), None) for p in positions}

    def state(evs, at):
        sh, cash = 0.0, 0.0
        for ts, d, c in evs:
            if ts > at:
                break
            sh = 0.0 if d == "ZERO" else sh + d
            cash += c
        return sh, cash

    relevant = {}
    for tok, evs in events.items():
        sh0, _ = state(evs, start)
        if sh0 > 1e-6 or any(ts > start for ts, _, _ in evs):
            relevant[tok] = (evs, price_history(tok, last_price.get(tok)))
    if not relevant:
        return []

    grid = list(range(start, int(now_ts) + 1, 60))
    out = []
    for m in grid:
        total = 0.0
        for evs, hist in relevant.values():
            sh, cash = state(evs, m)
            px = 0.0
            for ts, p in hist:
                if ts > m:
                    break
                px = p
            if not px and hist:
                px = hist[0][1]
            total += sh * px + cash
        out.append({"t": m, "pnl": round(total, 6)})
    return out


def build_pnl_ranges(now_ts, activity_raw, positions):
    """Profit/loss series per chart range:
       1H = every minute (rebuilt), 12H and 1D = every hour, 1W / 1M / ALL = every day."""
    res = {}

    def to_rows(pts):
        return [{"t": t, "pnl": v} for t, v in pts]

    for name, interval in (("12h", "12h"), ("1d", "1d")):
        try:
            res[name] = to_rows(pnl_points(interval, "1h"))
        except Exception as e:
            print(f"  user-pnl {name} unavailable: {e}", file=sys.stderr)

    # Daily series for the long ranges, built from the hourly history so no day is skipped.
    try:
        hourly = pnl_points("max", "1h")
        if len(hourly) > 2500:  # very old account: let Polymarket aggregate to days
            hourly = pnl_points("max", "1d")
        if hourly:
            by_day = {}
            for t, v in hourly:
                by_day[t // 86400] = (t, v)  # last reading of each UTC day
            days = [(hourly[0][0] - 3600, 0.0)] + [by_day[k] for k in sorted(by_day)]  # account starts at 0

            def window(span):
                cut = now_ts - span
                before = [p for p in days if p[0] < cut]
                inside = [p for p in days if p[0] >= cut]
                return ([before[-1]] if before else []) + inside

            res["1w"] = to_rows(window(7 * 86400))
            res["1m"] = to_rows(window(30 * 86400))
            res["all"] = to_rows(days)
    except Exception as e:
        print(f"  user-pnl daily unavailable: {e}", file=sys.stderr)

    # Minute-by-minute for the last hour (skipped if trades are delayed 1h+, so it can't leak them).
    try:
        res["1h"] = minute_pnl(now_ts, activity_raw, positions) if TRADE_DELAY_HOURS < 1 else []
    except Exception as e:
        print(f"  minute P&L unavailable: {e}", file=sys.stderr)
    return res


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def write_json(name, obj):
    # Write atomically so a crash mid-write can never leave a half-written (invalid) JSON file.
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / (name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, OUT / name)


def main():
    if not re.fullmatch(r"0x[0-9a-f]{40}", WALLET):
        sys.exit("WALLET_ADDRESS is missing or not a 0x... address. Set it in the repo's Actions variables.")

    now = datetime.now(timezone.utc)
    now_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"Updating {WALLET} at {now_s}")

    # --- Portfolio value (marked value of open positions) ---
    value = (api("/value").get("data") or {}).get("value")
    positions_value = num(value, None) if value is not None else None
    cash = cash_balance()

    # --- Positions ---
    open_rows = paged("/positions", status="OPEN")
    redeemable = paged("/positions", status="REDEEMABLE")
    seen, positions = set(), []
    for p in open_rows + redeemable:
        key = p.get("token_id")
        if key in seen:
            continue
        seen.add(key)
        positions.append(slim_position(p))
    positions.sort(key=lambda p: -p["value"])
    if positions_value is None:
        positions_value = round(sum(p["value"] for p in positions), 4)

    # --- Position history (closed) ---
    closed = [slim_position(p) for p in paged("/positions", status="CLOSED", sort_by="TIMESTAMP", sort_direction="DESC")]

    # --- Activity (trades etc.) ---
    activity_raw = paged("/activity", max_pages=15, exclude_deposits_withdrawals="false")
    transfers = [a for a in activity_raw if a.get("type") in ("DEPOSIT", "WITHDRAWAL")]
    net_deposits = None
    # Only trust the deposit total if the whole history was read (not cut off by the page cap).
    if transfers and len(activity_raw) < 15 * 100:
        net_deposits = sum(num(a.get("usdc_size") or a.get("size")) * (1 if a.get("type") == "DEPOSIT" else -1) for a in transfers)
        # Activity is capped at 15 pages: only trust this if the whole history was read.
    activity = [slim_activity(a) for a in activity_raw if a.get("type") != "DEPOSIT" and a.get("type") != "WITHDRAWAL"]
    cutoff = now.timestamp() - TRADE_DELAY_HOURS * 3600
    activity = [a for a in activity if a["time"] and datetime.fromisoformat(a["time"].replace("Z", "+00:00")).timestamp() <= cutoff]
    activity = activity[:500]

    # The trade delay must cover everything that reveals a fresh trade, not just the activity feed.
    # Hide positions and closed positions touched inside the delay window. (Account totals such as
    # total value and cash still reflect "now"; they can't be delayed without being wrong.)
    if TRADE_DELAY_HOURS > 0:
        def settled(row):
            ts = row.get("last_activity") or row.get("opened")
            return not ts or datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() <= cutoff
        positions = [p for p in positions if settled(p)]
        closed = [c for c in closed if settled(c)]

    # --- Stats / PnL series (best effort: never fail the run over these) ---
    stats, pnl_series = None, []
    try:
        stats = api("/user-stats").get("data")
    except Exception as e:
        print(f"  user-stats unavailable: {e}", file=sys.stderr)
    pnl_ranges = build_pnl_ranges(now.timestamp(), activity_raw, positions)
    if TRADE_DELAY_HOURS > 0:  # a P&L curve also reveals when trades happened
        pnl_ranges = {k: [pt for pt in v if pt["t"] <= cutoff] for k, v in pnl_ranges.items()}
    pnl_series = pnl_ranges.get("all", [])
    volume = None
    try:
        volume = api("/user-volume").get("data")
    except Exception as e:
        print(f"  user-volume unavailable: {e}", file=sys.stderr)

    # --- Metrics from closed positions ---
    wins = [c for c in closed if c["realized_pnl"] > 0]
    losses = [c for c in closed if c["realized_pnl"] < 0]
    gross_win = sum(c["realized_pnl"] for c in wins)
    gross_loss = -sum(c["realized_pnl"] for c in losses)
    decided = len(wins) + len(losses)
    realized_total = sum(c["realized_pnl"] for c in closed)
    unrealized_total = sum(p["unrealized_pnl"] for p in positions)
    open_cost = sum(p["cost"] for p in positions)
    total_value = (positions_value or 0) + (cash or 0) if cash is not None else None

    metrics = {
        "closed_count": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": (len(wins) / decided) if decided else None,
        "avg_win": (gross_win / len(wins)) if wins else None,
        "avg_loss": (-gross_loss / len(losses)) if losses else None,
        "profit_factor": (gross_win / gross_loss) if gross_loss else None,
        "best": max(closed, key=lambda c: c["realized_pnl"])["realized_pnl"] if closed else None,
        "worst": min(closed, key=lambda c: c["realized_pnl"])["realized_pnl"] if closed else None,
        "best_title": max(closed, key=lambda c: c["realized_pnl"])["title"] if closed else None,
        "worst_title": min(closed, key=lambda c: c["realized_pnl"])["title"] if closed else None,
        "realized_pnl": realized_total,
        "unrealized_pnl": unrealized_total,
        "total_pnl": realized_total + unrealized_total,
        "open_count": len(positions),
        "open_cost": open_cost,
        "largest_position_pct": (max((p["value"] for p in positions), default=0) / positions_value) if positions_value else None,
        "markets_traded": (stats or {}).get("trades") if isinstance(stats, dict) else None,
        "volume_usdc": (volume or {}).get("volume_usdc") if isinstance(volume, dict) else None,
        "trade_count": (volume or {}).get("trade_count") if isinstance(volume, dict) else None,
        "net_deposits": net_deposits,
        "pnl_vs_deposits": (total_value - net_deposits) if (total_value is not None and net_deposits is not None) else None,
    }

    summary = {
        "updated": now_s,
        "wallet": WALLET,
        "total_value": total_value,
        "positions_value": positions_value,
        "cash": cash,
        "trade_delay_hours": TRADE_DELAY_HOURS,
        "metrics": metrics,
    }

    # --- Equity snapshots: Polymarket only reports value *now*, so we record it each run ---
    equity = load_json(OUT / "equity.json", [])
    if total_value is not None:
        last_t = datetime.fromisoformat(equity[-1]["t"].replace("Z", "+00:00")).timestamp() if equity else 0
        if now.timestamp() - last_t >= EQUITY_MIN_GAP_S:
            equity.append(
                {
                    "t": now_s,
                    "total": round(total_value, 2),
                    "positions": round(positions_value or 0, 2),
                    "cash": round(cash or 0, 2),
                    "net_deposits": round(net_deposits, 2) if net_deposits is not None else None,
                }
            )
            equity = equity[-EQUITY_MAX_POINTS:]

    write_json("summary.json", summary)
    write_json("positions.json", positions)
    write_json("closed.json", closed)
    write_json("activity.json", activity)
    write_json("equity.json", equity)
    write_json("pnl_series.json", pnl_series)
    if pnl_ranges:
        write_json("pnl.json", pnl_ranges)
    cash_txt = f"{cash:,.2f}" if cash is not None else "n/a"
    print(f"Done. positions={len(positions)} closed={len(closed)} activity={len(activity)} cash={cash_txt}")


if __name__ == "__main__":
    main()
