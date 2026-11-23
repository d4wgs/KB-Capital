"use strict";
const wallet = "0x03e1859bcc5293ff3e2c4e9cb483dc76048d5f2d";
const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const dollars = n => money.format(n);
const cents = n => (100 * n).toLocaleString("en-US", {maximumFractionDigits:3}) + "¢";
const signedDollars = n => n == null ? "—" : (Number(n) > 0 ? "+" : "") + dollars(n);
const percent = n => (100 * n).toFixed(1) + "%";
let checked;

async function pages(path, filters) {
  const rows = [];
  const seen = new Set();
  let cursor;
  do {
    const params = {user:wallet, ...filters, limit:100};
    if (cursor) params.cursor = cursor;
    const page = await walletApi.pollApi(path, params);
    if (!Array.isArray(page.data)) throw Error("Missing positions");
    rows.push(...page.data);
    cursor = page.pagination?.next_cursor;
    if (cursor && seen.has(cursor)) throw Error("Repeated cursor");
    seen.add(cursor);
  } while (cursor);
  return rows;
}

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

const palette = ["#2355a1", "#a54317", "#745296", "#006a81", "#9a384c", "#65591e"];
let chart, pinned, activeSlices = [], markedNav = 0;
const legend = byId("legend");

function inspect(id) {
  const index = activeSlices.findIndex(s => s.id === id);
  const slice = activeSlices[index];
  byId("ring-label").textContent = slice ? slice.label : "Marked NAV";
  byId("nav").textContent = dollars(slice ? slice.amount : markedNav);
  Array.from(legend.children).forEach((button, i) => {
    button.classList.toggle("highlight", i === index);
    button.setAttribute("aria-pressed", String(activeSlices[i].id === pinned));
  });
  chart.setActiveElements(index < 0 ? [] : [{datasetIndex:0,index}]);
  chart.render();
}

function toggle(id) {
  pinned = pinned === id ? null : id;
  inspect(pinned);
}

function drawAllocation(slices, nav) {
  const focusId = document.activeElement?.dataset.slice;
  activeSlices = slices;
  markedNav = nav;
  if (!slices.some(s => s.id === pinned)) pinned = null;
  if (!chart) {
    chart = new Chart(byId("donut"), {
      type:"doughnut", data:{datasets:[{}]}, plugins:[ChartDataLabels],
      options:{
        cutout:"70%", layout:{padding:8}, animation:false,
        events:["mousemove","mouseout","click"],
        onHover:(event, items) => inspect(items.length ? activeSlices[items[0].index].id : pinned),
        onClick:(event, items) => { if (items.length) toggle(activeSlices[items[0].index].id); },
        plugins:{legend:{display:false}, tooltip:{enabled:false}, datalabels:{
          color:"white", font:{weight:"bold",size:13},
          display:ctx => markedNav > 0 && activeSlices[ctx.dataIndex].amount / markedNav >= 0.075,
          formatter:(_,ctx) => String.fromCharCode(65 + ctx.dataIndex % 26) + (ctx.dataIndex >= 26 ? Math.floor(ctx.dataIndex / 26) : "")
        }}
      }
    });
    byId("donut").addEventListener("mouseleave", () => inspect(pinned));
  }
  chart.data.labels = slices.map(s => s.label);
  Object.assign(chart.data.datasets[0], {data:slices.map(s => s.amount), backgroundColor:slices.map(s => s.color),
    hoverBackgroundColor:slices.map(s => s.color), borderColor:"white", borderWidth:2, hoverOffset:6});
  const buttons = slices.map((slice,index) => {
    const button = node("button","");
    button.type = "button";
    button.dataset.slice = slice.id;
    const mark = node("span",String.fromCharCode(65 + index % 26) + (index >= 26 ? Math.floor(index / 26) : ""));
    mark.className = "slice-mark";
    mark.style.backgroundColor = slice.color;
    button.append(mark,node("span",slice.label),node("strong",dollars(slice.amount)),node("small",percent(nav ? slice.amount/nav : 0)));
    button.onpointerenter = e => { if (e.pointerType === "mouse") inspect(slice.id); };
    button.onpointerleave = () => inspect(pinned);
    button.onfocus = () => inspect(slice.id);
    button.onblur = () => inspect(pinned);
    button.onclick = () => toggle(slice.id);
    return button;
  });
  legend.replaceChildren(...buttons);
  chart.update("none");
  inspect(pinned);
  buttons.find(b => b.dataset.slice === focusId)?.focus({preventScroll:true});
}

function renderHoldings(container, rows, closed, daily, trades) {
  const expanded = new Set(Array.from(container.querySelectorAll("details[open]"), el => el.dataset.token));
  const focus = container.contains(document.activeElement) ? document.activeElement.closest("details")?.dataset.token : null;
  const cards = rows.map(p => {
    const item = document.createElement("details");
    item.className = "holding";
    item.dataset.token = p.token_id;
    item.open = expanded.has(p.token_id);
    const summary = document.createElement("summary");
    const signed = signedDollars(p.realized_pnl);
    summary.append(node("strong",p.title),node("small",p.outcome + " · " +
      (closed ? "Closed" : p.redeemable ? "Redeemable" : "Open")));
    const comparison = node("span","");
    comparison.className = "holding-comparison";
    for (const [label,value] of [["Today",daily.get(p.token_id)],["Since entry",p.total_pnl]]) {
      const cell = node("span","");
      const figure = node("b",signedDollars(value));
      figure.className = value > 0 ? "gain" : value < 0 ? "loss" : "";
      cell.append(node("small",label),figure);
      comparison.append(cell);
    }
    summary.append(comparison);
    const fields = document.createElement("dl");
    fields.className = "holding-fields";
    const shares = Number(closed ? p.total_size : p.current_size).toLocaleString("en-US",{maximumFractionDigits:6});
    const metrics = [
      [closed ? "Total shares" : "Shares held",shares],
      ...(!closed ? [["Total shares bought",Number(p.total_size).toLocaleString("en-US",{maximumFractionDigits:6})]] : []),
      ["Average entry",cents(p.avg_price)],
      ...(closed ? [["Last activity", new Date(p.last_event_at * 1000).toLocaleString()]] :
        [["Current mark",cents(p.current_price)],["Marked value",dollars(p.current_value)]]),
      ["Realized P&L",signed],
      ...(!closed ? [["Unrealized P&L",signedDollars(p.unrealized_pnl)],["Total P&L",signedDollars(p.total_pnl)]] : [])
    ];
    for (const [name,value] of metrics) {
      const field = document.createElement("div");
      const number = node("dd",value);
      if (name.endsWith("P&L")) number.className = value.startsWith("+") ? "gain" : value.startsWith("-") ? "loss" : "";
      field.append(node("dt",name),number);
      fields.append(field);
    }
    item.append(summary,fields);
    const marketFills = trades.filter(f => f.type === "TRADE" && f.token_id === p.token_id);
    if (marketFills.length) {
      const list = node("ul","");
      list.className = "holding-fills";
      for (const f of marketFills) list.append(node("li",new Date(f.timestamp*1000).toLocaleString() + " · " +
        f.side + " " + Number(f.size).toLocaleString(undefined,{maximumFractionDigits:4}) + " @ " + cents(f.price)));
      item.append(node("strong","Fills"),list);
    }
    return item;
  });
  container.replaceChildren(...(cards.length ? cards : [node("p",closed ? "No closed holdings." : "No open or redeemable holdings.")]));
  if (focus) cards.find(c => c.dataset.token === focus)?.firstElementChild.focus({preventScroll:true});
}

const openingMarks = new Map();
async function openingMark(token, start) {
  const key = start + ":" + token;
  if (openingMarks.has(key)) return openingMarks.get(key);
  const params = new URLSearchParams({market:token,startTs:start-3600,endTs:start,fidelity:1});
  const response = await fetch("https://clob.polymarket.com/prices-history?" + params,{signal:AbortSignal.timeout(10000)});
  if (!response.ok) return null;
  const history = (await response.json()).history;
  const mark = history?.filter(h => h.t <= start && h.t >= start-300).sort((a,b) => b.t-a.t)[0]?.p;
  if (!Number.isFinite(mark)) return null;
  openingMarks.set(key,mark);
  return mark;
}

async function dailyBreakdown(rows, activity, points, start, nav) {
  const values = new Map();
  const opening = points.find(p => p.timestamp === start);
  if (!opening || !Number.isFinite(opening.position_pnl)) return {values};
  const overnight = [];
  let knownOpening = 0;
  for (const p of rows) {
    if (!Number.isFinite(p.total_pnl)) return {values:new Map()};
    if (p.first_entry_at >= start) values.set(p.token_id,p.total_pnl);
    else if (p.status === "CLOSED" && p.last_event_at < start) {
      knownOpening += p.total_pnl;
      values.set(p.token_id,0);
    } else overnight.push(p);
  }
  const today = activity.filter(a => a.timestamp >= start);
  // A single carried position owns the entire opening position P&L left after prior closes.
  if (overnight.length === 1) {
    const p = overnight[0];
    values.set(p.token_id,p.total_pnl - (opening.position_pnl-knownOpening));
  } else {
    await Promise.all(overnight.map(async p => {
      const events = today.filter(a => a.condition_id === p.condition_id);
      if (events.some(a => a.type !== "TRADE")) return;
      let openingSize = Number(p.current_size), proceeds = 0;
      for (const f of events.filter(f => f.token_id === p.token_id)) {
        const sign = f.side === "SELL" ? 1 : -1;
        openingSize += sign*f.size;
        proceeds += sign*f.usdc_size;
      }
      const mark = await openingMark(p.token_id,start).catch(() => null);
      if (mark != null) values.set(p.token_id,p.current_value + proceeds - openingSize*mark);
    }));
  }
  const latest = points.filter(p => p.timestamp >= start).sort((a,b) => b.timestamp-a.timestamp)[0];
  const income = p => p.economic_pnl - p.position_pnl;
  const gain = rows.reduce((sum,p) => sum+p.total_pnl,0) - opening.position_pnl + income(latest)-income(opening);
  const transfers = today.reduce((sum,a) => sum + (a.type === "DEPOSIT" ? a.usdc_size : a.type === "WITHDRAWAL" ? -a.usdc_size : 0),0);
  const openingNav = nav-gain-transfers;
  return {values,gain,openingNav,rate:openingNav > 0 ? gain/openingNav : null,estimated:overnight.length > 1};
}

async function refresh() {
  try {
    const start = Math.floor(Date.now()/86400000)*86400;
    const [cash,open,redeemable,closed,activity,series] = await Promise.all([
      walletApi.cashOnChain(wallet), ...["OPEN","REDEEMABLE","CLOSED"].map(status => pages("/positions",{status})),
      pages("/activity",{exclude_deposits_withdrawals:"false"}).catch(() => null),
      walletApi.pollApi("/user-pnl",{user:wallet,interval:"1w",fidelity:"1h"}).catch(() => null)
    ]);
    const rows = [...new Map([...open,...redeemable].map(p => [p.token_id,p])).values()];
    if (!Number.isFinite(cash) || rows.some(p => p.current_value == null || !Number.isFinite(Number(p.current_value)))) throw Error("Missing balance");
    rows.sort((a,b) => b.current_value-a.current_value);
    const slices = [{id:"cash", label:"Cash (pUSD)", amount:cash, color:"#185646"}];
    rows.forEach((p,i) => {
      slices.push({id:p.token_id,label:p.title + " · " + p.outcome,amount:Number(p.current_value),color:palette[i % palette.length]});
    });
    const nav = slices.reduce((sum,s) => sum+s.amount,0);
    drawAllocation(slices, nav);
    const all = [...new Map([...closed,...rows].map(p => [p.token_id,p])).values()];
    const daily = activity && series?.data?.points ? await dailyBreakdown(all,activity,series.data.points,start,nav) : {values:new Map()};
    byId("daily-money").textContent = signedDollars(daily.gain);
    const target = daily.openingNav > 0 ? daily.openingNav * 0.01 : null;
    const gap = target == null ? null : target - daily.gain;
    byId("target-base").textContent = Number.isFinite(daily.openingNav) ? dollars(daily.openingNav) : "—";
    byId("target-profit").textContent = target == null ? "—" : dollars(target);
    byId("target-label").textContent = gap < 0 ? "Above target today" : "Still needed today";
    byId("target-gap").textContent = gap == null ? "—" : dollars(Math.abs(gap));
    byId("daily-return").textContent = daily.rate == null ? "" : (daily.rate > 0 ? "+" : "") + (daily.rate*100).toFixed(2) + "%";
    byId("daily-date").textContent = new Date(start*1000).toISOString().slice(0,10) + " · Since 00:00 UTC · " +
      (daily.gain == null ? "Opening data unavailable" : "Deposits and withdrawals excluded") +
      (daily.estimated ? " · Overnight holding changes use historical marks and fill amounts before fees." : "");
    const trades = (activity || []).sort((a,b) => b.timestamp-a.timestamp);
    renderHoldings(byId("holdings"),rows,false,daily.values,trades);
    renderHoldings(byId("history"),closed.sort((a,b) => b.last_event_at-a.last_event_at),true,daily.values,trades);
    byId("history-status").textContent = "";
    checked = new Date().toLocaleString();
    byId("status").textContent = "Polymarket positions and Polygon cash · Updated " + checked;
  } catch {
    byId("status").textContent = "Wallet refresh unavailable. " + (checked ? "Showing balances from " + checked + "." : "Waiting for live balances.");
  } finally {
    setTimeout(refresh,60000);
  }
}
let fills = [];
let fillsChecked;
const filter = byId("fill-market");
function renderFills() {
  const visible = fills.filter(f => !filter.value || f.condition_id === filter.value);
  const cards = visible.map(f => {
    const card = document.createElement("article");
    const time = new Date(f.timestamp * (f.timestamp < 1e12 ? 1000 : 1));
    const title = node("strong", f.title);
    const side = f.side === "BUY" ? "Bought" : "Sold";
    const summary = node("p", side + " " + Number(f.size).toLocaleString(undefined,{maximumFractionDigits:4}) +
      " " + f.outcome + " at " + cents(f.price) + " · " + dollars(f.usdc_size));
    card.append(title,summary,node("small",time.toLocaleString()));
    return card;
  });
  byId("fills").replaceChildren(...(cards.length ? cards : [node("p","No recent fills for this selection.")]));
}

async function refreshFills() {
  try {
    const page = await walletApi.pollApi("/activity",{user:wallet,type:"TRADE",limit:100});
    if (!Array.isArray(page.data)) throw Error("Missing activity");
    fills = page.data.filter(f => f.type === "TRADE" && ["BUY","SELL"].includes(f.side))
      .sort((a,b) => b.timestamp-a.timestamp);
    const markets = new Map(fills.map(f => [f.condition_id,f.title]));
    const previous = filter.value;
    filter.replaceChildren(new Option("All traded markets",""),
      ...Array.from(markets, ([id,title]) => new Option(title,id)));
    if (markets.has(previous)) filter.value = previous;
    renderFills();
    fillsChecked = new Date().toLocaleString();
    byId("fills-status").textContent = "Latest " + fills.length + " wallet fills · Updated " + fillsChecked;
  } catch {
    byId("fills-status").textContent = fillsChecked ? "Refresh unavailable · Last updated " + fillsChecked : "Wallet fills unavailable. Retrying in one minute.";
  } finally {
    setTimeout(refreshFills,60000);
  }
}
filter.addEventListener("change",renderFills);
refreshFills();
refresh();
