/* Calendar tab: one box per day from the portfolio's first trade.
   Green = the day's profit was 1%+ of portfolio value at the start of that day; red = it wasn't.
   Reads the same saved JSON as the Predictions page (/data), so it needs no extra API calls. */
(function () {
  "use strict";

  var TARGET = 0.01, DAY = 86400;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function $(id) { return document.getElementById(id); }
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function get(url) {
    return fetch(url + "?v=" + Date.now(), { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }
  function usd(x) { return x.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
  // Round first so a tiny float like -0.000001 shows as $0.00 / 0.00% with no sign.
  function sUsd(x) { var c = Math.round(x * 100); return (c > 0 ? "+" : c < 0 ? "-" : "") + usd(Math.abs(c) / 100); }
  function sPct(x) { if (!isNum(x)) return "—"; var c = Math.round(x * 10000); return (c > 0 ? "+" : c < 0 ? "-" : "") + (Math.abs(c) / 100).toFixed(2) + "%"; }
  function dayNum(sec) { return Math.floor(sec / DAY); }           // UTC day index
  function ymd(dn) { var d = new Date(dn * DAY * 1000); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() }; }
  function dayOf(y, m, d) { return Math.floor(Date.UTC(y, m, d) / (DAY * 1000)); }

  var days = {};          // day index -> { pnl, delta, base, pct, hit, trades }
  var first = null, last = null, view = null;   // view = { y, m }

  /* Build one record per day from the first trade to today. */
  function build(summary, pnl, activity) {
    var series = ((pnl && pnl.all) || []).filter(function (p) { return isNum(p.t) && isNum(p.pnl); })
      .sort(function (a, b) { return a.t - b.t; });
    var trades = (activity || []).filter(function (a) { return a.type === "TRADE" && a.time; })
      .map(function (a) { return Math.floor(new Date(a.time).getTime() / 1000); });

    var start = trades.length ? Math.min.apply(null, trades) : series.length ? series[0].t : null;
    if (start === null) return false;
    first = dayNum(start);
    last = Math.max(first, dayNum(Date.parse(summary.updated) / 1000));

    var eod = {};                                   // last P&L reading of each day
    series.forEach(function (p) { eod[dayNum(p.t)] = p.pnl; });

    var m = (summary && summary.metrics) || {};

    // The hourly P&L series lags (and marks open positions at the last hourly price). If the summary is newer
    // than the series, end the last day on the summary's total P&L (realized + unrealized) so the closing
    // profit of a trade made after the last hourly reading is not missed.
    var upd = summary && summary.updated ? new Date(summary.updated).getTime() / 1000 : 0;
    if (isNum(m.total_pnl) && upd > (series.length ? series[series.length - 1].t : 0)) eod[dayNum(upd)] = m.total_pnl;
    var flows = summary.capital_flows;
    var opening = new Map(((pnl && pnl.midnight) || []).map(p => [dayNum(p.t), p.pnl]));
    var prev = 0;
    for (var d = first; d <= last; d++) {
      if (opening.has(d)) prev = opening.get(d);
      var cum = opening.has(d+1) ? opening.get(d+1) : eod[d] !== undefined ? eod[d] : prev;
      var funded = Array.isArray(flows) ? flows.reduce((sum,f) => sum + (f.t < d*DAY ? f.amount : 0),0) : null;
      var base = funded === null ? null : funded + prev;
      if (funded > 0 && isNum(summary.total_value) && isNum(m.total_pnl) && isNum(m.net_deposits)) {
        base += summary.total_value - m.total_pnl - m.net_deposits;
      }
      var delta = cum - prev;
      var pct = base > 0 ? delta / base : null;
      days[d] = {
        pnl: cum, delta: delta, base: base, pct: pct, hit: pct >= TARGET,
        trades: trades.filter(function (t) { return dayNum(t) === d; }).length
      };
      prev = cum;
    }
    return true;
  }

  function tip(dn, r) {
    var t = ymd(dn);
    var rows = [["P&L", sUsd(r.delta)], ["Return", sPct(r.pct)]];
    if (r.base !== null) rows.push(["Start value", usd(r.base)]);
    if (r.base > 0) {
      var target = r.base * TARGET;
      rows.push(["1% target", usd(target)], [r.hit ? "Above target" : "Gap to target", usd(Math.abs(target-r.delta))]);
    }
    rows.push(["Trades", String(r.trades)]);
    var dl = el("dl");
    rows.forEach(function (x) { dl.appendChild(el("dt", { text: x[0] })); dl.appendChild(el("dd", { text: x[1] })); });
    var inProg = dn === dayNum(Date.now()/1000) ? " (in progress)" : "";
    return el("div", { class: "cal-tip", role: "tooltip" }, [
      el("h4", { text: DOW[t.w] + ", " + SHORT[t.m] + " " + t.d + ", " + t.y + inProg }),
      dl,
      el("p", { class: "st " + (r.hit ? "hit" : "miss"), text: r.pct === null ? "No funded opening balance" : r.hit ? "Hit the 1% target" : "Under the 1% target" })
    ]);
  }

  function render() {
    var grid = $("cal-grid");
    grid.textContent = "";
    $("cal-title").textContent = MONTHS[view.m] + " " + view.y;

    var lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    var count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    grid.style.setProperty("--weeks", String(Math.ceil((lead + count) / 7)));  // rows share the screen height
    var i;
    for (i = 0; i < lead; i++) grid.appendChild(el("div", { class: "day blank", "aria-hidden": "true" }));

    var hit = 0, miss = 0, total = 0;
    for (i = 1; i <= count; i++) {
      var dn = dayOf(view.y, view.m, i), r = days[dn];
      var box = el("div", { class: "day", role: "gridcell" }, [el("span", { class: "n", text: String(i) })]);
      if (r) {
        var rp = Math.round(r.pct * 10000);   // hundredths of a percent
        if (r.hit) box.className += " hit";
        else if (rp < 0) box.className += " miss";
        else if (rp > 0) { box.className += " gain"; box.style.setProperty("--t", String(r.pct / TARGET)); }
        else box.className += " flat";
        box.setAttribute("tabindex", "0");
        box.setAttribute("aria-label", MONTHS[view.m] + " " + i + ": " + sUsd(r.delta) + ", " + sPct(r.pct) + (r.hit ? ", hit target" : ", under target"));
        box.appendChild(el("span", { class: "p", text: sPct(r.pct) }));
        if (r.base > 0) box.appendChild(el("small",{class:"day-target",text:"Goal " + usd(r.base*TARGET)}));
        box.appendChild(tip(dn, r));
        if (r.pct !== null) { if (r.hit) hit++; else miss++; }
        total += r.delta;
      }
      if (dn === dayNum(Date.now()/1000)) box.className += " today";
      grid.appendChild(box);
    }

    var f = ymd(first);
    $("cal-sub").textContent = "Tracking since the first trade on " + SHORT[f.m] + " " + f.d + ", " + f.y + ". Target: 1% per day.";
    var sum = $("cal-sum");
    sum.textContent = "";
    var n = hit + miss;
    [[String(hit), "days hit 1%+"], [String(miss), "days under 1%"], [n ? Math.round(hit / n * 100) + "%" : "--", "hit rate this month"], [sUsd(total), "P&L this month"]]
      .forEach(function (x) { sum.appendChild(el("div", {}, [el("b", { text: x[0], class: x[1] === "P&L this month" ? (total < 0 ? "neg" : "pos") : "" }), el("span", { text: x[1] })])); });

    var a = ymd(first), b = ymd(last);
    $("prev").disabled = view.y * 12 + view.m <= a.y * 12 + a.m;
    $("next").disabled = view.y * 12 + view.m >= b.y * 12 + b.m;
  }

  function step(n) {
    var k = view.y * 12 + view.m + n;
    view = { y: Math.floor(k / 12), m: k % 12 };
    render();
  }

  function start() {
    $("prev").addEventListener("click", function () { step(-1); });
    $("next").addEventListener("click", function () { step(1); });

    Promise.all([
      get("/data/summary.json"),
      get("/data/pnl.json").catch(function () { return null; }),
      get("/data/activity.json").catch(function () { return []; })
    ]).then(function (r) {
      if (!build(r[0], r[1], r[2])) { $("cal-sub").textContent = "No trades yet."; return; }
      var t = ymd(last);
      view = { y: t.y, m: t.m };                      // this month
      render();
      if (r[0].updated) $("updated").textContent = "Data updated " + new Date(r[0].updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ".";
    }).catch(function () { $("cal-sub").textContent = "Data not available yet."; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
