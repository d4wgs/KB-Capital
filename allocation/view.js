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

async function refresh() {
  try {
    const [cash, open, redeemable] = await Promise.all([walletApi.cashOnChain(wallet), positions("OPEN"), positions("REDEEMABLE")]);
    const rows = [...new Map([...open,...redeemable].map(p => [p.token_id,p])).values()];
    if (!Number.isFinite(cash) || rows.some(p => p.current_value == null || !Number.isFinite(Number(p.current_value)))) throw Error("Missing balance");
    rows.sort((a,b) => b.current_value-a.current_value);
    const slices = [{label:"Cash (pUSD)", amount:cash, color:"#284f44"}];
    const details = [];
    rows.forEach((p,i) => {
      const label = p.title + " · " + p.outcome;
      slices.push({label, amount:Number(p.current_value), color:"hsl(" + ((40+i*73)%360) + " 51% 48%)"});
      const item = document.createElement("article");
      item.append(node("h3",label), node("p",p.status + " · " + p.current_size + " shares · Entry " + cents(p.avg_price) + " · Mark " + cents(p.current_price)), node("p","Marked value " + dollars(p.current_value) + " · Unrealized P&L " + dollars(p.unrealized_pnl)));
      details.push(item);
    });
    const nav = slices.reduce((sum,s) => sum+s.amount,0);
    let start = 0;
    const legend = [], stops = [];
    for (const s of slices) {
      const fraction = nav ? s.amount/nav : 0;
      stops.push(s.color+" "+start+"% "+(start+fraction*100)+"%");
      start += fraction*100;
      const row = document.createElement("div"), term = node("dt",s.label);
      term.style.borderColor = s.color;
      row.append(term,node("dd",dollars(s.amount)+" · "+percent(fraction)));
      legend.push(row);
    }
    byId("ring").style.background = !nav ? "#ddd" : slices.length === 1 ? slices[0].color : "conic-gradient("+stops.join(",")+")";
    byId("nav").textContent = dollars(nav);
    byId("legend").replaceChildren(...legend);
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
