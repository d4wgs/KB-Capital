(function () {
  "use strict";
  var DATA_API = "https://data-api.polymarket.com/v2";
  var RPCS = ["https://polygon.drpc.org", "https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com"];
  var PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
  function pollApi(path, params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(DATA_API + path + "?" + qs, { signal: AbortSignal.timeout(12000), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          var e = new Error("HTTP " + r.status);
          e.status = r.status;
          e.retryAfter = Number(r.headers.get("Retry-After")) || 0;
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
      return fetch(RPCS[i], { method: "POST", headers: { "Content-Type": "application/json" }, body: body, signal: AbortSignal.timeout(12000), credentials: "omit", referrerPolicy: "no-referrer" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) {
          if (!j || typeof j.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(j.result)) throw new Error("bad result");
          return Number(BigInt(j.result)) / 1e6;
        })
        .catch(function () { return tryRpc(i + 1); });
    }
    return tryRpc(0);
  }

  window.walletApi = { pollApi, cashOnChain };
})();
