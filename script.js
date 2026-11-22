/* KB Capital: Polymarket-style portfolio page.
   Reads the JSON files in /data (refreshed by scripts/update.py) and draws the page.
   Market details are fetched from Polymarket's public Gamma API when a row is opened. */

(function () {
  "use strict";

  var PAGE = 25;
  var GAMMA = "https://gamma-api.polymarket.com/markets";

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function isNum(x) { return typeof x === "number" && isFinite(x); }

  function get(url) {
    return fetch(url + "?v=" + Date.now(), { cache: "no-store", credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  function usd(x, digits) {
    if (!isNum(x)) return "--";
    return x.toLocaleString("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }
  function signedUsd(x) {
    if (!isNum(x)) return "--";
    return (x > 0 ? "+" : x < 0 ? "-" : "") + usd(Math.abs(x));
  }
  function compact(x) {
    if (!isNum(x)) return "--";
    if (x >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    if (x >= 1e4) return "$" + (x / 1e3).toFixed(1) + "K";
    return usd(x, 0);
  }
  // Exact to the cent below $1,000, whole dollars below $10K, then K/M, like Polymarket's own market stats.
  function money(x) {
    if (!isNum(x)) return "--";
    return x < 1000 ? usd(x, 2) : compact(x);
  }
  function cents(x) {
    var n = Number(x);
    return x !== null && x !== "" && x !== undefined && isFinite(n) ? (Math.round(n * 1000) / 10) + "¢" : "--";
  }
  function shares(x) { return isNum(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "--"; }
  function cls(x) { return !isNum(x) || x === 0 ? "" : x > 0 ? "pos" : "neg"; }

  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else if (k === "style") n.style.cssText = props[k]; // CSSOM, so it works under a strict CSP
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  var dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  var dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  var monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  var hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

  function d(s) { return s ? dateFmt.format(new Date(s.length === 10 ? s + "T12:00:00" : s)) : "--"; }
  function dt(s) { return s ? dateTimeFmt.format(new Date(s)) : "--"; }

  function ago(s) {
    var mins = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var h = Math.round(mins / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function validSlug(s) { return typeof s === "string" && /^[a-z0-9-]+$/i.test(s); }
  function marketUrl(row) {
    var s = row.event_slug || row.slug;
    return validSlug(s) ? "https://polymarket.com/event/" + s : null;
  }
  // Only load market pictures from Polymarket's own image host (so a bad API value can't make
  // visitors' browsers contact other sites), and only with characters that are safe inside CSS url("...").
  var IMG_HOST = "https://polymarket-upload.s3.us-east-2.amazonaws.com/";
  function safeImg(u) {
    return typeof u === "string" && u.indexOf(IMG_HOST) === 0 && /^https:\/\/[A-Za-z0-9._~\/%+-]+$/.test(u) ? u : null;
  }

  /* ---------- state ---------- */

  var S = {
    summary: null, positions: [], closed: [], activity: [], pnl: null,
    view: "positions", status: "active", q: "", sort: { active: "value", closed: "recent" },
    shownPos: PAGE, shownAct: PAGE, range: "1d",
    market: {}, // slug -> gamma market (or null)
    marketAt: {} // slug -> when that market data was fetched (ms)
  };

  /* ---------- profile card ---------- */

  function utcStamp(value) {
    var t = Date.parse(value);
    return isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace("T", " ") : "--";
  }

  /* ---------- return by deposit period ---------- */

  var PERIOD_CLUSTER_S = 6 * 3600; // transfers closer together than this count as one deposit event

  function toSec(t) { t = Number(t); return t > 1e12 ? t / 1000 : t; }

  // Split the fund's life at each deposit/withdrawal. A period's return is its P&L divided by the portfolio value
  // right after the transfer, so a large later deposit starts a fresh base instead of diluting earlier gains.
  // Start P&L comes from the saved snapshot (hourly history); a transfer newer than the snapshot starts at the live P&L.
  function chartPnlAt(t) {
    var best = null, bestT = -Infinity;
    ["all", "1m", "1w", "1d", "12h"].forEach(function (k) {
      ((S.pnl && S.pnl[k]) || []).forEach(function (p) {
        if (isNum(p.t) && isNum(p.pnl) && p.t <= t && p.t > bestT) { bestT = p.t; best = p.pnl; }
      });
    });
    return best === null ? (S.pnl ? 0 : null) : best;   // before the first reading the account was at zero
  }

  function buildPeriods() {
    var s = S.summary, flows = s && s.capital_flows;
    if (!Array.isArray(flows) || !flows.length) return null;
    var events = [];
    flows.map(function (f) { return { t: toSec(f.t), amount: Number(f.amount) }; })
      .sort(function (a, b) { return a.t - b.t; })
      .forEach(function (f) {
        var last = events[events.length - 1];
        if (last && f.t - last.t <= PERIOD_CLUSTER_S) { last.t = f.t; last.amount += f.amount; }
        else events.push({ t: f.t, amount: f.amount });
      });
    var saved = S.savedPeriods || [];
    var savedEnd = saved.length ? saved[saved.length - 1].end_pnl : null;
    var nowPnl = S.livePnl != null ? S.livePnl : savedEnd;
    var cum = 0;
    var out = events.map(function (e) {
      cum += e.amount;
      var hit = saved.filter(function (p) { return Math.abs(p.t - e.t) < 2; })[0];
      // Order of trust: saved hourly value, then the saved P&L chart series (older transfers), then live P&L (brand-new transfer).
      var p0 = hit ? hit.pnl_start : e.t * 1000 <= S.savedTime ? chartPnlAt(e.t) : nowPnl;
      if (p0 === null) p0 = nowPnl;
      return { t: e.t, flow: e.amount, net: cum, p0: p0, start: isNum(p0) ? cum + p0 : null };
    });
    out.forEach(function (p, i) {
      var next = out[i + 1];
      p.endT = next ? next.t : null;
      p.p1 = next ? next.p0 : nowPnl;
      p.gain = isNum(p.p0) && isNum(p.p1) ? p.p1 - p.p0 : null;
      p.ret = isNum(p.gain) && p.start > 0.5 ? p.gain / p.start : null;
      var days = ((p.endT || Date.now() / 1000) - p.t) / 86400;
      p.perDay = isNum(p.ret) && days >= 1 && p.ret > -1 ? Math.pow(1 + p.ret, 1 / days) - 1 : null;
    });
    return out;
  }

  function pct(x, digits) {
    return isNum(x) ? (x > 0 ? "+" : "") + (100 * x).toFixed(digits == null ? 2 : digits) + "%" : "--";
  }

  function renderPeriods() {
    var body = $("periods-body");
    if (!body) return;
    var periods = buildPeriods();
    body.textContent = "";
    $("periods-panel").hidden = !periods;
    if (!periods) { $("track-twr").textContent = "--"; return; }
    var twr = 1, any = false;
    periods.forEach(function (p) { if (isNum(p.ret)) { twr *= 1 + p.ret; any = true; } });
    $("track-twr").textContent = any ? pct(twr - 1) : "--";
    $("track-twr").className = any ? cls(twr - 1) : "";
    periods.slice().reverse().forEach(function (p) {
      var cur = p.endT === null;
      var label = d(new Date(p.t * 1000).toISOString()) + " → " + (cur ? "now" : d(new Date(p.endT * 1000).toISOString()));
      var th = el("th", { scope: "row", text: label }, cur ? [el("span", { class: "pill-now", text: "current" })] : []);
      body.appendChild(el("tr", {}, [
        th,
        el("td", { text: signedUsd(p.flow) }),
        el("td", { text: usd(p.start) }),
        el("td", { class: cls(p.gain), text: signedUsd(p.gain) }),
        el("td", { class: "ret " + cls(p.ret), text: pct(p.ret) }),
        el("td", { class: cls(p.perDay), text: p.perDay === null ? "--" : pct(p.perDay) + "/day" })
      ]));
    });
  }

  function renderSavedReturn(s) {
    var capital = (s.metrics || {}).net_deposits;
    var gain = isNum(s.total_value) && isNum(capital) ? s.total_value - capital : null;
    $("track-nav").textContent = usd(s.total_value);
    $("track-capital").textContent = usd(capital);
    $("track-gain").textContent = signedUsd(gain);
    $("track-return").textContent = isNum(gain) && capital > 0
      ? (gain > 0 ? "+" : "") + (100 * gain / capital).toFixed(2) + "%" : "--";
    $("track-gain").className = cls(gain);
    $("track-return").className = "big " + cls(capital > 0 ? gain : null);
    $("track-time").textContent = utcStamp(S.savedUpdated || s.updated);
    renderPeriods();
  }

  function renderLatestFill() {
    var latest = S.activity.reduce(function (last, row) {
      return row.type === "TRADE" && row.time > last ? row.time : last;
    }, "");
    $("track-fill").textContent = utcStamp(latest);
  }

  function renderSummary(s) {
    S.summary = s;
    var m = s.metrics || {};
    $("s-positions").textContent = usd(s.positions_value);
    $("s-best").textContent = isNum(m.best) && m.best > 0 ? usd(m.best) : "--";
    $("s-markets").textContent = isNum(m.markets_traded) ? String(m.markets_traded) : "--";
    $("s-volume").textContent = isNum(m.volume_usdc) ? usd(m.volume_usdc) : "--";
    $("s-cash").textContent = usd(s.cash);
    renderTotalPnl();
    if (s.wallet) { $("meta").textContent = s.wallet; $("copy-addr").disabled = false; }
    $("updated").textContent = s.updated ? (s.live ? "Live data, updated " : "Saved data, updated ") + ago(s.updated) + " (" + dt(s.updated) + ")." : "";
  }

  function renderTotalPnl() {
    var n = $("s-pnl");
    var v = null;
    if (S.livePnl != null) v = S.livePnl;
    else if (S.pnl && S.pnl.all && S.pnl.all.length) v = S.pnl.all[S.pnl.all.length - 1].pnl;
    else if (S.summary && S.summary.metrics) v = S.summary.metrics.total_pnl;
    n.textContent = signedUsd(v);
    n.className = cls(v);
  }

  /* ---------- P&L chart ---------- */

  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  // Span of each range (for the empty-state line) and how its points are spaced.
  var RANGE_MS = { "1h": 36e5, "12h": 12 * 36e5, "1d": 864e5, "1w": 7 * 864e5, "1m": 30 * 864e5 };
  var LABELS = { "1h": "Past hour · minute by minute", "12h": "Past 12 hours · hour by hour", "1d": "Past 24 hours · hour by hour", "1w": "Past week · day by day", "1m": "Past month · day by day", "all": "All time · day by day" };

  function seriesFor(range) {
    var raw = (S.pnl && S.pnl[range]) || [];
    var end = S.summary && S.summary.updated ? new Date(S.summary.updated).getTime() : Date.now();
    var pts = raw
      .filter(function (p) { return isNum(p.t) && isNum(p.pnl); })
      .map(function (p) { return { t: p.t * 1000, v: p.pnl }; })
      .sort(function (a, b) { return a.t - b.t; });
    // Extend the line to "now": with the live P&L figure when we have it (not for the rebuilt 1H view,
    // which is on a different basis), otherwise by carrying the last value forward.
    if (range !== "1h" && S.livePnl != null && pts.length && end > pts[pts.length - 1].t) {
      pts.push({ t: end, v: range !== "1h" && S.livePnl != null ? S.livePnl : pts[pts.length - 1].v });
    }
    if (range === "all") {
      // All-time P&L starts at zero when the account does.
      if (pts.length && pts[0].v !== 0) pts.unshift({ t: pts[0].t - 36e5, v: 0 });
    } else if (pts.length) {
      // Other ranges show the change over the period.
      var base = pts[0].v;
      pts = pts.map(function (p) { return { t: p.t, v: p.v - base }; });
    }
    if (pts.length < 2) {
      var span = RANGE_MS[range] || 7 * 864e5;
      pts = [{ t: end - span, v: 0 }, { t: end, v: 0 }];
    }
    return pts;
  }

  // Monotone cubic interpolation so the curve never overshoots the data.
  function smoothPath(xs, ys) {
    var n = xs.length, i;
    if (n < 3) return xs.map(function (x, k) { return (k ? "L" : "M") + x.toFixed(1) + " " + ys[k].toFixed(1); }).join(" ");
    var dx = [], m = [], t = new Array(n);
    for (i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; m[i] = (ys[i + 1] - ys[i]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var p = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      var h = dx[i] / 3;
      p += " C" + (xs[i] + h).toFixed(1) + " " + (ys[i] + t[i] * h).toFixed(1) + " " +
        (xs[i + 1] - h).toFixed(1) + " " + (ys[i + 1] - t[i + 1] * h).toFixed(1) + " " +
        xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
    }
    return p;
  }

  // Target earnings only: external cash earns the strategy rate from its transfer time.
  function targetProfit(flows, time) {
    return flows.reduce(function (profit, flow) {
      var days = (time - flow.t * 1000) / 86400000;
      return days > 0 ? profit + flow.amount * Math.expm1(Math.log1p(.01) * days) : profit;
    }, 0);
  }

  function renderPnl() {
    var box = $("pl-chart");
    box.textContent = "";
    var pts = seriesFor(S.range);
    var last = pts[pts.length - 1].v;

    $("pl-value").textContent = usd(last);
    $("pl-value").className = "pl-value " + cls(last);
    var arrow = $("pl-arrow");
    arrow.textContent = last < 0 ? "▼" : "▲";
    arrow.className = "arrow" + (last < 0 ? " down" : "");
    var label = LABELS[S.range];
    var asOf = S.summary && S.summary.updated ? " · as of " + dt(S.summary.updated) : "";
    $("pl-foot").textContent = S.pnl ? label + asOf : "No profit/loss data yet";

    var W = Math.max(200, Math.round(box.clientWidth || 460));
    var H = Math.max(120, Math.round(box.clientHeight || 160));
    var T = 12, B = 8;
    var xs = pts.map(function (p) { return p.t; });
    var ys = pts.map(function (p) { return p.v; });
    var x0 = xs[0], x1 = xs[xs.length - 1];
    var flows = S.summary && S.summary.capital_flows;
    var available = Array.isArray(flows) && flows.length && S.pnl && S.pnl[S.range] && S.pnl[S.range].length;
    var targets = [];
    if (available) {
      var base = S.range === "all" ? 0 : targetProfit(flows, x0);
      targets = xs.map(function (time) { return targetProfit(flows, time) - base; });
    }
    var target = targets.length ? targets[targets.length - 1] : null;
    var gap = target === null ? null : last - target;
    $("pl-target").textContent = signedUsd(target);
    $("pl-gap").textContent = signedUsd(gap);
    $("pl-gap").className = cls(gap);
    $("pl-foot").textContent = available ? label + " · through " + dt(new Date(x1).toISOString()) : label + " · target comparison unavailable";
    var domain = ys.concat(targets, 0);
    var lo = Math.min.apply(null, domain), hi = Math.max.apply(null, domain);
    if (hi === lo) { hi = lo + 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;

    function X(t) { return x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * W; }
    function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); }

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" });
    var defs = svg("defs");
    var sg = svg("linearGradient", { id: "plStroke", x1: 0, y1: 0, x2: 1, y2: 0 });
    sg.appendChild(svg("stop", { offset: "0", "stop-color": "#5b5bf0" }));
    sg.appendChild(svg("stop", { offset: "1", "stop-color": "#8a4cf0" }));
    var ag = svg("linearGradient", { id: "plFill", x1: 0, y1: 0, x2: 0, y2: 1 });
    ag.appendChild(svg("stop", { offset: "0", "stop-color": "#5b5bf0", "stop-opacity": ".22" }));
    ag.appendChild(svg("stop", { offset: "1", "stop-color": "#5b5bf0", "stop-opacity": "0" }));
    defs.appendChild(sg); defs.appendChild(ag);
    root.appendChild(defs);

    var zeroY = Y(0);
    root.appendChild(svg("line", { class: "zero", x1: 0, x2: W, y1: zeroY, y2: zeroY }));

    var px = xs.map(X), py = ys.map(Y);
    var path = smoothPath(px, py);
    root.appendChild(svg("path", { class: "ar", fill: "url(#plFill)", d: path + " L" + W + " " + (H - B) + " L0 " + (H - B) + " Z" }));
    root.appendChild(svg("path", { class: "ln", d: path, "vector-effect": "non-scaling-stroke" }));

    if (targets.length) root.appendChild(svg("path", { class: "target-line", d: smoothPath(px, targets.map(Y)), "vector-effect": "non-scaling-stroke" }));

    var hv = svg("line", { class: "hv", y1: T, y2: H - B, x1: 0, x2: 0, visibility: "hidden" });
    var dot = svg("circle", { class: "dot", r: 5, cx: 0, cy: 0, visibility: "hidden" });
    root.appendChild(hv); root.appendChild(dot);
    box.appendChild(root);

    var tip = el("div", { class: "tip" });
    tip.hidden = true;
    box.appendChild(tip);

    function move(ev) {
      var r = root.getBoundingClientRect();
      var cx = ((ev.clientX - r.left) / r.width) * W;
      var best = 0;
      for (var i = 1; i < px.length; i++) if (Math.abs(px[i] - cx) < Math.abs(px[best] - cx)) best = i;
      hv.setAttribute("x1", px[best]); hv.setAttribute("x2", px[best]); hv.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px[best]); dot.setAttribute("cy", py[best]); dot.setAttribute("visibility", "visible");
      var when = new Date(xs[best]);
      tip.hidden = false;
      tip.textContent = signedUsd(ys[best]) + " · " + (S.range === "1h" ? hourFmt.format(when) : S.range === "12h" || S.range === "1d" ? dateTimeFmt.format(when) : dateFmt.format(when));
      var left = (px[best] / W) * r.width;
      tip.style.left = Math.min(Math.max(left, 80), r.width - 80) + "px";
    }
    function leave() { hv.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; }
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
  }

  /* ---------- market data (Gamma API, best effort) ---------- */

  function parseList(x) {
    if (Array.isArray(x)) return x;
    try { var v = JSON.parse(x); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  // Fetch market data once per slug. The in-flight request is remembered so a row opened
  // while the page is still loading waits for it instead of reporting "unavailable".
  var pending = {};
  function loadMarkets(slugs) {
    var want = slugs.filter(function (s, i) { return validSlug(s) && slugs.indexOf(s) === i; });
    var need = want.filter(function (s) { return !pending[s]; });
    for (var i = 0; i < need.length; i += 20) fetchBatch(need.slice(i, i + 20));
    return Promise.all(want.map(function (s) { return pending[s]; }));
  }

  function fetchBatch(batch) {
    var qs = batch.map(function (s) { return "slug=" + encodeURIComponent(s); }).join("&");
    // The API returns open and closed markets separately, so ask for both.
    function one(extra) {
      return fetch(GAMMA + "?" + qs + extra + "&limit=" + batch.length, { credentials: "omit", referrerPolicy: "no-referrer" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (list) {
          (Array.isArray(list) ? list : []).forEach(function (m) {
            if (m && typeof m.slug === "string" && batch.indexOf(m.slug) >= 0) { S.market[m.slug] = m; S.marketAt[m.slug] = Date.now(); }
          });
        })
        .catch(function () { /* offline or blocked: rows still work from local data */ });
    }
    var p = Promise.all([one(""), one("&closed=true")]);
    batch.forEach(function (s) { pending[s] = p; });
  }

  function thumb(row) {
    var m = S.market[row.slug];
    var img = m && safeImg(m.icon || m.image);
    var t = el("div", { class: "thumb" });
    if (img) t.style.backgroundImage = 'url("' + img + '")';
    else t.textContent = (row.title || "?").charAt(0).toUpperCase();
    return t;
  }

  function refreshThumbs() {
    var hold = [];
    [S.positions, S.closed, S.activity].forEach(function (l) { l.forEach(function (r) { hold.push(r.slug); }); });
    return loadMarkets(hold).then(function () { renderList(); });
  }

  /* ---------- details ---------- */

  function fact(label, value, wide, node) {
    var dd = el("dd", { text: node ? "" : value });
    if (node) dd.appendChild(node);
    return el("div", { class: wide ? "wide" : "" }, [el("dt", { text: label }), dd]);
  }

  function buildDetail(row, kind) {
    var wrap = el("div", { class: "detail" });
    var left = el("div");
    var right = el("div");
    wrap.appendChild(left); wrap.appendChild(right);

    var url = marketUrl(row);
    var head = el("div", { class: "d-head" }, [thumb(row)]);
    var tt = el("div");
    var h = el("h3", { text: row.title || "Unknown market" });
    if (url) {
      var a = el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, [h]);
      tt.appendChild(a);
    } else tt.appendChild(h);
    tt.appendChild(el("p", { class: "d-sub", text: "Market data" + (row.end_date ? " · ends " + d(row.end_date) : "") }));
    head.appendChild(tt);
    left.appendChild(head);

    var outsBox = el("div", { class: "outs" });
    var descBox = el("p", { class: "desc" });
    left.appendChild(outsBox);
    left.appendChild(descBox);

    var m = S.market[row.slug];
    var extra = []; // market stat rows added by fillMarket
    function fillMarket(m) {
      outsBox.textContent = "";
      var names = parseList(m.outcomes), prices = parseList(m.outcomePrices);
      names.forEach(function (name, i) {
        var p = Number(prices[i]);
        if (!isFinite(p)) return;
        var mine = row.outcome && name === row.outcome;
        outsBox.appendChild(el("div", { class: "out" + (mine ? " mine" : "") }, [
          el("b", { text: name, title: mine ? "Your outcome" : name }),
          el("div", { class: "bar" }, [el("i", { style: "width:" + Math.max(1, Math.min(100, p * 100)) + "%" })]),
          el("span", { text: Math.round(p * 100) + "%" })
        ]));
      });
      if (m.description) descBox.textContent = m.description;
      // Replace (not add to) the market stats, so a refresh never duplicates them.
      extra.forEach(function (n) { n.remove(); });
      extra = [];
      var more = [];
      var vol = Number(m.volumeNum != null ? m.volumeNum : m.volume);
      var liq = Number(m.liquidityClob != null ? m.liquidityClob : (m.liquidityNum != null ? m.liquidityNum : m.liquidity));
      var ev = m.events && m.events[0];
      var evVol = ev ? Number(ev.volume) : NaN;
      if (isFinite(vol)) more.push(fact("Market volume", money(vol)));
      if (isFinite(liq)) more.push(fact("Market liquidity", money(liq)));
      // Polymarket's page headline is the whole event's volume; show it too so the two aren't confused.
      if (isFinite(evVol) && ev.slug !== m.slug && Math.abs(evVol - vol) > 0.5) more.push(fact("Event volume (all markets)", money(evVol)));
      more.push(fact("Market status", m.closed ? "Closed" : (m.active === false ? "Inactive" : "Open")));
      if (m.endDate) more.push(fact("Resolves", d(m.endDate)));
      more.forEach(function (n) { facts.appendChild(n); extra.push(n); });
    }

    var facts = el("dl", { class: "facts" });
    right.appendChild(facts);

    if (kind === "activity") {
      facts.appendChild(fact("Action", ((row.side ? row.side + " " : "") + (row.outcome || "") || row.type || "--").trim()));
      facts.appendChild(fact("Time", dt(row.time)));
      if (row.shares) facts.appendChild(fact("Shares", shares(row.shares)));
      if (row.price !== null && row.price !== undefined && row.price !== "") facts.appendChild(fact("Price", cents(row.price)));
      if (row.usdc) facts.appendChild(fact("Amount", usd(row.usdc)));
      if (typeof row.tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(row.tx)) {
        facts.appendChild(fact("Transaction", "", true, el("a", { href: "https://polygonscan.com/tx/" + row.tx, target: "_blank", rel: "noopener noreferrer", text: row.tx.slice(0, 10) + "…" + row.tx.slice(-6) })));
      }
    } else {
      facts.appendChild(fact("Outcome", row.outcome || "--"));
      facts.appendChild(fact("Shares", shares(kind === "closed" ? row.total_size : row.size)));
      facts.appendChild(fact("Avg price", cents(row.avg_price)));
      facts.appendChild(fact(kind === "closed" ? "Final price" : "Current price", cents(row.current_price)));
      if (kind !== "closed") {
        facts.appendChild(fact("Cost", usd(row.cost)));
        facts.appendChild(fact("Value", usd(row.value)));
      }
      var pnl = kind === "closed" ? row.realized_pnl : row.total_pnl;
      var pnlN = el("span", { class: cls(pnl), text: signedUsd(pnl) });
      facts.appendChild(fact(kind === "closed" ? "Realized P&L" : "Total P&L", "", false, pnlN));
      if (row.opened) facts.appendChild(fact("Opened", dt(row.opened)));
      if (row.last_activity) facts.appendChild(fact("Last activity", dt(row.last_activity)));
    }
    if (url) facts.appendChild(fact("Polymarket", "", true, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "View market on polymarket.com ↗" })));

    if (m) fillMarket(m);
    if (validSlug(row.slug)) {
      var stale = !m || Date.now() - (S.marketAt[row.slug] || 0) > 30000; // volume and liquidity move; re-read when opened
      if (!m) outsBox.appendChild(el("p", { class: "d-loading", text: "Loading market data…" }));
      if (stale) {
        if (m) delete pending[row.slug];
        loadMarkets([row.slug]).then(function () {
          var fresh = S.market[row.slug];
          if (fresh) fillMarket(fresh);
          else if (!m) { outsBox.textContent = ""; outsBox.appendChild(el("p", { class: "d-loading", text: "Live market data unavailable right now." })); }
        });
      }
    }
    return wrap;
  }

  function toggleRow(row, rowEl, kind) {
    var next = rowEl.nextElementSibling;
    if (next && next.classList.contains("detail")) {
      next.remove();
      rowEl.setAttribute("aria-expanded", "false");
      if (S.dirty) { S.dirty = false; renderList(); } // apply live changes that arrived while this row was open
      return;
    }
    rowEl.parentNode.querySelectorAll(".detail").forEach(function (n) {
      n.previousElementSibling.setAttribute("aria-expanded", "false");
      n.remove();
    });
    rowEl.setAttribute("aria-expanded", "true");
    rowEl.parentNode.insertBefore(buildDetail(row, kind), rowEl.nextSibling);
  }

  function makeRow(row, kind, inner) {
    var r = el("div", { class: "row", role: "row", tabindex: "0", "aria-expanded": "false" }, inner);
    function go() { toggleRow(row, r, kind); }
    r.addEventListener("click", function (e) { if (e.target.closest("a")) return; go(); });
    r.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    return r;
  }

  /* ---------- lists ---------- */

  function side(outcome) {
    var o = String(outcome || "").toLowerCase();
    return o === "no" ? "pill no" : o === "yes" ? "pill" : "pill neutral";
  }

  function posRow(p, kind) {
    var mkt = el("div", { class: "mkt" }, [
      thumb(p),
      el("div", { class: "mkt-text" }, [
        el("div", { class: "mkt-title", text: p.title || "Unknown market", title: p.title || "" }),
        el("div", { class: "sub" }, [
          el("span", { class: side(p.outcome), text: p.outcome || "--" }),
          el("span", { text: kind === "closed" ? shares(p.total_size) + " shares" : shares(p.size) + " shares" }),
          p.status === "REDEEMABLE" ? el("span", { class: "pill neutral", text: "Resolved" }) : null
        ])
      ])
    ]);
    var avg = el("div", { class: "num r c-avg", text: cents(p.avg_price) });
    var cur = el("div", { class: "num r c-cur", text: cents(p.current_price) });
    var val;
    if (kind === "closed") {
      val = el("div", { class: "num r " + cls(p.realized_pnl) }, [document.createTextNode(signedUsd(p.realized_pnl))]);
      val.appendChild(el("small", { class: "muted", text: d(p.last_activity) }));
    } else {
      val = el("div", { class: "num r" }, [document.createTextNode(usd(p.value))]);
      val.appendChild(el("small", { class: cls(p.total_pnl), text: signedUsd(p.total_pnl) + " total P&L" }));
    }
    return makeRow(p, kind, [mkt, avg, cur, val]);
  }

  function actRow(a) {
    var type = a.type === "TRADE" ? (a.side || "Trade") : (a.type || "--");
    type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    var tcls = "muted";
    var mkt = el("div", { class: "mkt" }, [
      thumb(a),
      el("div", { class: "mkt-text" }, [
        el("div", { class: "mkt-title", text: a.title || "Unknown market", title: a.title || "" }),
        el("div", { class: "sub" }, [
          a.outcome ? el("span", { class: side(a.outcome), text: a.outcome }) : null,
          a.shares ? el("span", { text: shares(a.shares) + " shares" + (a.price != null && a.price !== "" ? " at " + cents(a.price) : "") }) : null,
          a.time ? el("span", { class: "t-inline", text: "· " + ago(a.time) }) : null
        ])
      ])
    ]);
    var amt = el("div", { class: "num r money", text: a.usdc ? usd(a.usdc) : "--" });
    var time = el("div", { class: "num r muted c-time", text: a.time ? ago(a.time) : "--", title: dt(a.time) });
    return makeRow(a, "activity", [el("div", { class: "num " + tcls, text: type }), mkt, amt, time]);
  }

  function head(cols, klass) {
    var h = el("div", { class: "thead " + (klass || ""), role: "row" });
    cols.forEach(function (c) { h.appendChild(el("div", { class: c[1] || "", text: c[0] })); });
    return h;
  }

  function renderList() {
    if (S.view === "positions") renderPositions(); else renderActivity();
    // With nothing to list, fit the whole page to the window so it doesn't scroll.
    var t = $(S.view === "positions" ? "t-positions" : "t-activity");
    document.body.classList.toggle("fit", !t.querySelector(".row"));
  }

  function renderPositions() {
    var t = $("t-positions");
    t.textContent = "";
    t.className = "table";
    var closed = S.status === "closed";
    var rows = (closed ? S.closed : S.positions).slice();
    var q = S.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (r) { return ((r.title || "") + " " + (r.outcome || "")).toLowerCase().indexOf(q) >= 0; });

    var by = SORTS[S.status][S.sort[S.status]] || SORTS[S.status].recent;
    rows.sort(function (a, b) {
      var x = by.fn(a), y = by.fn(b);
      if (typeof x === "string" || typeof y === "string") return String(y).localeCompare(String(x));
      return (y || 0) - (x || 0);
    });
    if ($("sort").value !== S.sort[S.status]) $("sort").value = S.sort[S.status];

    t.appendChild(head(closed
      ? [["Market"], ["Avg", "r c-avg"], ["Final", "r c-cur"], ["P&L", "r"]]
      : [["Market"], ["Avg", "r c-avg"], ["Current", "r c-cur"], ["Value", "r"]]));

    if (!rows.length) {
      t.appendChild(el("p", { class: "empty-msg", text: q ? "No positions match your search." : "No positions found" }));
      $("pos-more").hidden = true;
      return;
    }
    rows.slice(0, S.shownPos).forEach(function (r) { t.appendChild(posRow(r, closed ? "closed" : "active")); });
    var more = $("pos-more");
    more.hidden = rows.length <= S.shownPos;
    more.textContent = "Show more (" + (rows.length - S.shownPos) + " left)";
  }

  function renderActivity() {
    var t = $("t-activity");
    t.textContent = "";
    t.className = "table act";
    t.appendChild(head([["Type"], ["Market"], ["Amount", "r"], ["Time", "r c-time-h"]], "act"));
    if (!S.activity.length) {
      t.appendChild(el("p", { class: "empty-msg", text: "No activity yet" }));
      $("act-more").hidden = true;
      return;
    }
    S.activity.slice(0, S.shownAct).forEach(function (a) { t.appendChild(actRow(a)); });
    var more = $("act-more");
    more.hidden = S.activity.length <= S.shownAct;
    more.textContent = "Show more (" + (S.activity.length - S.shownAct) + " left)";
  }

  /* ---------- sorting ---------- */

  // Closed positions report a leftover "cost" (not the amount originally put in), so use shares x avg price.
  function ret(p, pnl, closed) {
    var c = closed ? (p.total_size || 0) * (p.avg_price || 0) : p.cost;
    return c > 0 ? pnl / c : 0;
  }

  var SORTS = {
    active: {
      value:  { label: "Value", fn: function (p) { return p.value; } },
      pnl:    { label: "Profit/Loss", fn: function (p) { return p.total_pnl; } },
      ret:    { label: "Return", fn: function (p) { return ret(p, p.total_pnl); } },
      recent: { label: "Latest", fn: function (p) { return p.last_activity || ""; } }
    },
    closed: {
      recent: { label: "Latest", fn: function (p) { return p.last_activity || ""; } },
      pnl:    { label: "Profit/Loss", fn: function (p) { return p.realized_pnl; } },
      ret:    { label: "Return", fn: function (p) { return ret(p, p.realized_pnl, true); } },
      size:   { label: "Amount bought", fn: function (p) { return (p.total_size || 0) * (p.avg_price || 0); } }
    }
  };

  function fillSortOptions() {
    var sel = $("sort"), opts = SORTS[S.status];
    sel.textContent = "";
    Object.keys(opts).forEach(function (k) { sel.appendChild(el("option", { value: k, text: opts[k].label })); });
    sel.value = S.sort[S.status];
  }

  /* ---------- live updates ----------
     The saved JSON (refreshed by GitHub every 15 min) paints the page instantly. Then, every 30 s while the
     tab is visible, the page asks Polymarket's public read-only API for fresh numbers. It pauses when the tab
     is hidden or offline, and slows down automatically if Polymarket rate-limits or errors. */

  var DATA_API = "https://data-api.polymarket.com/v2";
  var RPCS = ["https://polygon.drpc.org", "https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com"];
  var PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
  var LIVE_MS = 30000, LIVE_MAX_MS = 300000;
  var L = { timer: null, delay: LIVE_MS, fails: 0, busy: false, last: 0, started: false, closedAt: 0, statsAt: 0 };

  function toNum(x, dflt) { var n = Number(x); return x !== null && x !== "" && x !== undefined && isFinite(n) ? n : (dflt === undefined ? 0 : dflt); }
  function isoOf(ts) {
    var n = toNum(ts, 0);
    if (n <= 0) return null;
    if (n > 1e12) n /= 1000;
    return new Date(n * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  }

  function pollApi(path, params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(DATA_API + path + "?" + qs, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          var e = new Error("HTTP " + r.status);
          e.status = r.status;
          e.retryAfter = toNum(r.headers.get("Retry-After"), 0);
          throw e;
        }
        return r.json();
      });
  }

  function cashOnChain(wallet) {
    var body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: PUSD, data: "0x70a08231" + wallet.slice(2).padStart(64, "0") }, "latest"] });
    function tryRpc(i) {
      if (i >= RPCS.length) return Promise.resolve(null);
      return fetch(RPCS[i], { method: "POST", headers: { "Content-Type": "application/json" }, body: body, credentials: "omit", referrerPolicy: "no-referrer" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) {
          if (!j || typeof j.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(j.result)) throw new Error("bad result");
          return Number(BigInt(j.result)) / 1e6;
        })
        .catch(function () { return tryRpc(i + 1); });
    }
    return tryRpc(0);
  }

  function slimPos(p) {
    return {
      title: p.title, slug: p.slug, event_slug: p.event_slug, outcome: p.outcome, status: p.status,
      size: toNum(p.current_size), total_size: toNum(p.total_size), avg_price: toNum(p.avg_price),
      current_price: p.current_price, cost: toNum(p.entry_cost_usdc), value: toNum(p.current_value),
      realized_pnl: toNum(p.realized_pnl), unrealized_pnl: toNum(p.unrealized_pnl), total_pnl: toNum(p.total_pnl),
      percent_pnl: p.percent_pnl, end_date: p.end_date, opened: isoOf(p.first_entry_at), last_activity: isoOf(p.last_event_at),
      condition_id: p.condition_id, token_id: p.token_id
    };
  }
  function slimAct(a) {
    return {
      time: isoOf(a.timestamp), type: a.type, side: a.side, title: a.title, slug: a.slug, event_slug: a.event_slug,
      outcome: a.outcome, shares: toNum(a.size), usdc: toNum(a.usdc_size), price: a.price, tx: a.transaction_hash
    };
  }

  // Live rows replace the saved rows they cover; older saved rows (beyond the live page) are kept.
  function mergeRows(live, saved, timeKey) {
    if (!live.length) return saved;
    var oldest = live.reduce(function (m, r) { return r[timeKey] && r[timeKey] < m ? r[timeKey] : m; }, "9999");
    return live.concat(saved.filter(function (r) { return r[timeKey] && r[timeKey] < oldest; }));
  }

  function setLiveBadge(state) {
    var b = $("live");
    if (!b) return;
    b.className = "live " + state;
    var text = { live: "Live", paused: "Paused", retry: "Reconnecting", saved: "Saved data" }[state] || "";
    b.querySelector("b").textContent = text;
    b.title = state === "live" ? "Updating every 30 seconds from Polymarket"
      : state === "paused" ? "Paused while this tab is hidden"
      : state === "retry" ? "Polymarket didn't respond; trying again shortly"
      : "Showing the last saved snapshot";
  }

  function pageDirty(changed) {
    if (!changed) return;
    if (document.querySelector(".detail")) { S.dirty = true; return; } // don't collapse a row someone is reading
    renderList();
  }

  function applyLive(r) {
    var s = S.summary;
    if (!s) return;
    var m = s.metrics || (s.metrics = {});

    // positions
    var changed = false;
    var open = r.open.data.concat(r.redeem.data), more = (r.open.pagination || {}).next_cursor || (r.redeem.pagination || {}).next_cursor;
    if (!more) {
      var seen = {}, pos = [];
      open.forEach(function (p) { var k = p.token_id; if (k && !seen[k]) { seen[k] = 1; pos.push(slimPos(p)); } });
      pos.sort(function (a, b) { return b.value - a.value; });
      if (JSON.stringify(pos) !== JSON.stringify(S.positions)) { S.positions = pos; changed = true; }
      var pv = isNum(r.value) ? r.value : pos.reduce(function (t, p) { return t + p.value; }, 0);
      s.positions_value = pv;
      m.open_count = pos.length;
      m.open_cost = pos.reduce(function (t, p) { return t + p.cost; }, 0);
      m.unrealized_pnl = pos.reduce(function (t, p) { return t + p.unrealized_pnl; }, 0);
      m.largest_position_pct = pv > 0 ? Math.max.apply(null, pos.map(function (p) { return p.value; }).concat(0)) / pv : null;
    }
    if (isNum(r.cash)) s.cash = r.cash;
    // Net contributions follow the live transfer list, so a new deposit moves it together with cash and portfolio value.
    if (Array.isArray(s.capital_flows) && s.capital_flows.length) {
      m.net_deposits = s.capital_flows.reduce(function (t, f) { return t + Number(f.amount); }, 0);
    }
    if (isNum(s.cash) && isNum(s.positions_value)) {
      s.total_value = s.positions_value + s.cash;
      if (isNum(m.net_deposits)) m.pnl_vs_deposits = s.total_value - m.net_deposits;
    }

    // activity (trades etc.)
    var act = r.activity.data
      .filter(function (a) { return a.type !== "DEPOSIT" && a.type !== "WITHDRAWAL"; }).map(slimAct);
    if (act.length) {
      var merged = mergeRows(act, S.activity, "time").slice(0, 500);
      if (JSON.stringify(merged) !== JSON.stringify(S.activity)) { S.activity = merged; changed = true; }
    }

    // closed positions + volume: slower cadence, or right away if something just changed
    if (r.closed) {
      var cl = mergeRows(r.closed.data.map(slimPos), S.closed, "last_activity");
      if (JSON.stringify(cl) !== JSON.stringify(S.closed)) { S.closed = cl; changed = true; }
      var wins = cl.filter(function (c) { return c.realized_pnl > 0; }), losses = cl.filter(function (c) { return c.realized_pnl < 0; });
      m.closed_count = cl.length; m.wins = wins.length; m.losses = losses.length;
      var best = cl.reduce(function (b, c) { return !b || c.realized_pnl > b.realized_pnl ? c : b; }, null);
      if (best) { m.best = best.realized_pnl; m.best_title = best.title; }
    }
    m.realized_pnl = S.closed.concat(S.positions).reduce(function (sum, row) { return sum + row.realized_pnl; }, 0);
    m.total_pnl = m.realized_pnl + (m.unrealized_pnl || 0);
    if (r.volume && r.volume.data && isNum(Number(r.volume.data.volume_usdc))) m.volume_usdc = Number(r.volume.data.volume_usdc);
    if (r.stats && r.stats.data && isNum(Number(r.stats.data.trades))) m.markets_traded = Number(r.stats.data.trades);

    // All-time P&L as of right now (the hourly series can lag by up to an hour)
    var ap = r.stats && r.stats.data && r.stats.data.all_time_pnl;
    if (ap && isNum(Number(ap.economic_pnl))) S.livePnl = Number(ap.economic_pnl);

    s.updated = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    s.live = true;
    renderLatestFill();
    renderSummary(s);
    renderSavedReturn(s);
    renderPnl();
    pageDirty(changed);
    refreshThumbsSoon();
  }

  var thumbTimer;
  function refreshThumbsSoon() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(function () {
      var hold = [];
      [S.positions, S.closed, S.activity].forEach(function (l) { l.forEach(function (x) { hold.push(x.slug); }); });
      loadMarkets(hold).then(function () { pageDirty(true); });
    }, 300);
  }

  function liveOnce() {
    var w = S.summary && S.summary.wallet;
    if (!/^0x[0-9a-f]{40}$/.test(w || "")) return Promise.reject(new Error("no wallet"));
    var now = Date.now();
    var slow = now - L.closedAt > 300000; // closed positions & volume every 5 min
    function p(path, extra) { return pollApi(path, Object.assign({ user: w }, extra || {})); }
    var jobs = {
      value: p("/value").then(function (j) { return j && j.data ? toNum(j.data.value, null) : null; }),
      open: p("/positions", { status: "OPEN", limit: 100 }),
      redeem: p("/positions", { status: "REDEEMABLE", limit: 100 }),
      activity: p("/activity", { limit: 100, exclude_deposits_withdrawals: "false" }),
      stats: p("/user-stats").catch(function () { return null; }), // includes the up-to-the-minute all-time P&L
      cash: cashOnChain(w)
    };
    if (slow) {
      jobs.closed = p("/positions", { status: "CLOSED", sort_by: "TIMESTAMP", sort_direction: "DESC", limit: 100 });
      jobs.volume = p("/user-volume").catch(function () { return null; });
    }
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (vals) {
      var r = {};
      keys.forEach(function (k, i) { r[k] = vals[i]; });
      r.open = { data: (r.open && r.open.data) || [], pagination: r.open && r.open.pagination };
      r.redeem = { data: (r.redeem && r.redeem.data) || [], pagination: r.redeem && r.redeem.pagination };
      if (r.activity && Array.isArray(r.activity.data)) {
        var feed = r.activity.data;
        var page = r.activity.pagination;
        var feedFlows = feed.filter(function (a) {
          return a.type === "DEPOSIT" || a.type === "WITHDRAWAL";
        }).map(function (a) {
          return { t: toSec(a.timestamp), amount: Number(a.usdc_size || a.size) * (a.type === "DEPOSIT" ? 1 : -1) };
        });
        var oldest = feed.reduce(function (lo, a) { return Math.min(lo, toSec(a.timestamp)); }, Infinity);
        if (page && !page.has_more && !page.next_cursor) {
          S.summary.capital_flows = feedFlows;   // the feed holds the whole history
        } else if (S.savedFlows && feed.length && oldest * 1000 <= S.savedTime) {
          // The feed reaches back past the last saved snapshot: keep saved transfers up to then, add newer ones from the feed.
          S.summary.capital_flows = S.savedFlows.filter(function (f) { return f.t * 1000 <= S.savedTime; })
            .concat(feedFlows.filter(function (f) { return f.t * 1000 > S.savedTime; }));
        }
        // Otherwise keep what we have; the next saved snapshot (every 15 minutes) re-reads the full history.
      }
      r.activity = { data: (r.activity && r.activity.data) || [] };
      if (r.closed) r.closed = { data: r.closed.data || [] };
      if (slow) L.closedAt = now;
      applyLive(r);
    });
  }

  function liveTick() {
    clearTimeout(L.timer);
    if (document.hidden || navigator.onLine === false) { setLiveBadge("paused"); return; }
    if (L.busy) return;
    L.busy = true;
    liveOnce().then(function () {
      L.fails = 0; L.delay = LIVE_MS; L.last = Date.now();
      setLiveBadge("live");
    }).catch(function (e) {
      L.fails++;
      // Back off: 30s, 60s, 2m, 4m, then 5m. Obey Retry-After if Polymarket sends one.
      L.delay = Math.min(LIVE_MAX_MS, Math.max((e && e.retryAfter ? e.retryAfter * 1000 : 0), LIVE_MS * Math.pow(2, L.fails - 1)));
      setLiveBadge(L.last ? "retry" : "saved");
    }).then(function () {
      L.busy = false;
      if (!document.hidden) L.timer = setTimeout(liveTick, L.delay + Math.random() * 5000); // jitter spreads visitors out
    });
  }

  function startLive() {
    if (L.started || !S.summary || S.summary.trade_delay_hours > 0) return;
    L.started = true;
    setLiveBadge("saved");
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { clearTimeout(L.timer); setLiveBadge("paused"); }
      else liveTick(); // refresh right away when the tab comes back
    });
    window.addEventListener("online", liveTick);
    window.addEventListener("offline", function () { clearTimeout(L.timer); setLiveBadge("paused"); });
    // keep the "updated Xs ago" text honest between polls
    setInterval(function () { if (!document.hidden && S.summary && S.summary.updated) $("updated").textContent = (S.summary.live ? "Live data, updated " : "Saved data, updated ") + ago(S.summary.updated) + " (" + dt(S.summary.updated) + ")."; }, 10000);
    liveTick();
  }

  /* ---------- wiring ---------- */

  function setOn(group, attr, val) {
    group.querySelectorAll("button").forEach(function (b) {
      var on = b.getAttribute(attr) === val;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function wire() {
    document.querySelector(".ranges").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      S.range = b.getAttribute("data-r");
      setOn(this, "data-r", S.range);
      renderPnl();
    });
    document.querySelector(".subtabs").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      S.view = b.getAttribute("data-v");
      setOn(this, "data-v", S.view);
      $("v-positions").hidden = S.view !== "positions";
      $("v-activity").hidden = S.view !== "activity";
      renderList();
    });
    document.querySelector(".seg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      S.status = b.getAttribute("data-s");
      S.shownPos = PAGE;
      setOn(this, "data-s", S.status);
      fillSortOptions();
      renderPositions();
    });
    $("q").addEventListener("input", function () { S.q = this.value; S.shownPos = PAGE; renderPositions(); });
    $("sort").addEventListener("change", function () { S.sort[S.status] = this.value; S.shownPos = PAGE; renderPositions(); });
    $("pos-more").addEventListener("click", function () { S.shownPos += PAGE; renderPositions(); });
    $("act-more").addEventListener("click", function () { S.shownAct += PAGE; renderActivity(); });

    var copyTimer;
    $("copy-addr").addEventListener("click", function () {
      var a = S.summary && S.summary.wallet;
      var status = $("copy-status");
      clearTimeout(copyTimer);
      if (!navigator.clipboard) { status.textContent = "Copy unavailable"; return; }
      navigator.clipboard.writeText(a).then(function () {
        status.textContent = "Copied";
        copyTimer = setTimeout(function () { status.textContent = ""; }, 1800);
      }).catch(function () { status.textContent = "Copy unavailable"; });
    });
    $("share").addEventListener("click", function () {
      var url = location.href;
      if (navigator.share) navigator.share({ title: "kb-capital", url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
    });

    // Redraw the chart whenever its box changes size (rotate, resize, zoom, TV, split view).
    var lastW = 0, lastH = 0, timer;
    function redraw() {
      var b = $("pl-chart"), w = b.clientWidth, h = b.clientHeight;
      if (Math.abs(w - lastW) > 4 || Math.abs(h - lastH) > 4) { lastW = w; lastH = h; renderPnl(); }
    }
    if (window.ResizeObserver) new ResizeObserver(function () { clearTimeout(timer); timer = setTimeout(redraw, 80); }).observe($("pl-chart"));
    else window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(redraw, 120); });
  }

  function start() {
    $("year").textContent = String(new Date().getFullYear());
    wire();
    fillSortOptions();
    renderPnl();
    renderList();

    get("/data/summary.json").then(function (s) { S.savedTime = Date.parse(s.updated); S.savedUpdated = s.updated; S.savedFlows = (s.capital_flows || []).slice(); S.savedPeriods = s.periods || []; renderSavedReturn(s); renderSummary(s); renderPnl(); }).catch(function () {
      $("updated").textContent = "Data not available yet. The first update runs shortly after setup.";
    }).then(after);
    var done = 0;
    function after() { if (++done === 5) { refreshThumbs(); startLive(); } }
    get("/data/positions.json").then(function (r) { S.positions = r; }).catch(function () {}).then(function () { renderList(); after(); });
    get("/data/closed.json").then(function (r) { S.closed = r; }).catch(function () {}).then(function () { renderList(); after(); });
    get("/data/activity.json").then(function (r) { S.activity = r; renderLatestFill(); }).catch(function () {}).then(function () { renderList(); after(); });
    get("/data/pnl.json").then(function (r) { S.pnl = r; renderTotalPnl(); renderPnl(); }).catch(function () {}).then(after);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
