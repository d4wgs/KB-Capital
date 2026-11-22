"use strict";
const wallet = "0x03e1859bcc5293ff3e2c4e9cb483dc76048d5f2d";
const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const dollars = n => money.format(n);
const cents = n => (100 * n).toLocaleString("en-US", {maximumFractionDigits:3}) + "¢";
const signedDollars = n => n == null ? "—" : (Number(n) > 0 ? "+" : "") + dollars(n);
const percent = n => (100 * n).toFixed(1) + "%";
let checked;

async function positions(status) {
  const rows = [];
  const seen = new Set();
  let cursor;
  do {
    const params = {user:wallet, status, limit:100};
    if (cursor) params.cursor = cursor;
    const page = await walletApi.pollApi("/positions", params);
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

function renderHoldings(container, rows, closed) {
  const expanded = new Set(Array.from(container.querySelectorAll("details[open]"), el => el.dataset.token));
  const focus = container.contains(document.activeElement) ? document.activeElement.closest("details")?.dataset.token : null;
  const cards = rows.map(p => {
    const item = document.createElement("details");
    item.className = "holding";
    item.dataset.token = p.token_id;
    item.open = expanded.has(p.token_id);
    const summary = document.createElement("summary");
    const pnl = Number(p.realized_pnl);
    const signed = signedDollars(p.realized_pnl);
    const pnlClass = pnl > 0 ? "gain" : pnl < 0 ? "loss" : "";
    const amount = node("b", closed ? signed : dollars(p.current_value));
    if (closed) amount.className = pnlClass;
    summary.append(node("strong",p.title),node("small",p.outcome + " · " +
      (closed ? "Realized P&L" : p.redeemable ? "Redeemable" : "Open")),amount);
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
    return item;
  });
  container.replaceChildren(...(cards.length ? cards : [node("p",closed ? "No closed holdings." : "No open or redeemable holdings.")]));
  if (focus) cards.find(c => c.dataset.token === focus)?.firstElementChild.focus({preventScroll:true});
}

async function refreshHistory() {
  try {
    const rows = await positions("CLOSED");
    rows.sort((a,b) => b.last_event_at-a.last_event_at);
    renderHoldings(byId("history"),rows,true);
    byId("history-status").textContent = "";
  } catch {
    byId("history-status").textContent = "Couldn’t refresh closed holdings. Retrying in one minute.";
  } finally {
    setTimeout(refreshHistory,60000);
  }
}
async function refresh() {
  try {
    const [cash, open, redeemable] = await Promise.all([walletApi.cashOnChain(wallet), positions("OPEN"), positions("REDEEMABLE")]);
    const rows = [...new Map([...open,...redeemable].map(p => [p.token_id,p])).values()];
    if (!Number.isFinite(cash) || rows.some(p => p.current_value == null || !Number.isFinite(Number(p.current_value)))) throw Error("Missing balance");
    rows.sort((a,b) => b.current_value-a.current_value);
    const slices = [{id:"cash", label:"Cash (pUSD)", amount:cash, color:"#185646"}];
    rows.forEach((p,i) => {
      slices.push({id:p.token_id,label:p.title + " · " + p.outcome,amount:Number(p.current_value),color:palette[i % palette.length]});
    });
    const nav = slices.reduce((sum,s) => sum+s.amount,0);
    drawAllocation(slices, nav);
    renderHoldings(byId("holdings"), rows, false);
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
refreshHistory();
