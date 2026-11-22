"use strict";
const wallet = "0x03e1859bcc5293ff3e2c4e9cb483dc76048d5f2d";
const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const dollars = n => money.format(n);
const cents = n => (100 * n).toLocaleString("en-US", {maximumFractionDigits:3}) + "¢";
const percent = n => (100 * n).toFixed(1) + "%";
let balances, checked;

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

function scenario() {
  const stake = byId("stake").valueAsNumber;
  const {cash, nav} = balances;
  const valid = Number.isFinite(stake) && stake >= 0 && stake <= cash && nav > 0;
  byId("exposure").hidden = !valid;
  if (!valid) {
    byId("scenario").textContent = nav ? "Enter an amount between $0 and " + dollars(cash) + "." : "Wallet balance is zero.";
    return;
  }
  const deployed = (nav - cash + stake) / nav;
  byId("scenario").textContent = percent(stake/nav) + " of NAV in this trade · " + dollars(cash-stake) + " cash remaining · " + percent(deployed) + " total holdings after purchase.";
  byId("exposure").value = deployed * 100;
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

async function refresh() {
  try {
    const [cash, open, redeemable] = await Promise.all([walletApi.cashOnChain(wallet), positions("OPEN"), positions("REDEEMABLE")]);
    const rows = [...new Map([...open,...redeemable].map(p => [p.token_id,p])).values()];
    if (!Number.isFinite(cash) || rows.some(p => p.current_value == null || !Number.isFinite(Number(p.current_value)))) throw Error("Missing balance");
    rows.sort((a,b) => b.current_value-a.current_value);
    const slices = [{id:"cash", label:"Cash (pUSD)", amount:cash, color:"#185646"}];
    const details = [];
    rows.forEach((p,i) => {
      const label = p.title + " · " + p.outcome;
      slices.push({id:p.token_id, label, amount:Number(p.current_value), color:palette[i % palette.length]});
      const item = document.createElement("article");
      item.append(node("h3",label), node("p",p.status + " · " + p.current_size + " shares · Entry " + cents(p.avg_price) + " · Mark " + cents(p.current_price)), node("p","Marked value " + dollars(p.current_value) + " · Unrealized P&L " + dollars(p.unrealized_pnl)));
      details.push(item);
    });
    const nav = slices.reduce((sum,s) => sum+s.amount,0);
    drawAllocation(slices, nav);
    byId("holdings").replaceChildren(...(details.length ? details : [node("p","No open or redeemable positions.")]));
    balances = {cash,nav};
    byId("stake").disabled = false;
    scenario();
    checked = new Date().toLocaleString();
    byId("status").textContent = "Polymarket positions and Polygon cash · Updated " + checked;
  } catch {
    byId("status").textContent = "Wallet refresh unavailable. " + (checked ? "Showing balances from " + checked + "." : "Waiting for live balances.");
  } finally {
    setTimeout(refresh,60000);
  }
}
byId("stake").addEventListener("input",scenario);
refresh();
