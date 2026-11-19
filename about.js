/* About page: "What we do" tabs and the FAQ accordion. */
(function () {
  "use strict";

  // Tabs: clicking one shows its panel and hides the others.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectTab(t); });
    t.addEventListener("keydown", function (e) {
      var next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (next === null) return;
      e.preventDefault();
      var n = tabs[(next + tabs.length) % tabs.length];
      selectTab(n);
      n.focus();
    });
  });

  // FAQ: one item open at a time.
  var qs = Array.prototype.slice.call(document.querySelectorAll(".faq-q"));
  qs.forEach(function (q) {
    q.addEventListener("click", function () {
      var open = q.getAttribute("aria-expanded") === "true";
      qs.forEach(function (o) {
        o.setAttribute("aria-expanded", "false");
        document.getElementById(o.getAttribute("aria-controls")).hidden = true;
      });
      if (!open) {
        q.setAttribute("aria-expanded", "true");
        document.getElementById(q.getAttribute("aria-controls")).hidden = false;
      }
    });
  });
})();
