/* KB Capital — live New York clock and NYSE session status.
   No network calls: everything is computed in the browser. */

(function () {
  "use strict";

  /* ---- Settings you can edit ---- */

  // Leave blank to hide the Contact section. Example: "contact@kbcap.fund"
  var CONTACT_EMAIL = "";

  /* ---- NYSE calendar ----
     Regular session: 9:30 AM to 4:00 PM New York time, Monday to Friday.
     Holidays and early closes (1:00 PM) are listed by year. Verify against
     https://www.nyse.com/markets/hours-calendars and add the next year before
     January. For a year that is not listed, the page shows the clock only and
     makes no open/closed claim. */

  var TZ = "America/New_York";
  var OPEN = { h: 9, m: 30 };
  var CLOSE = { h: 16, m: 0 };
  var EARLY = { h: 13, m: 0 };

  var HOLIDAYS = [
    // 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    // 2027
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"
  ];
  var EARLY_CLOSES = ["2026-11-27", "2026-12-24", "2027-11-26"];
  var COVERED_YEARS = [2026, 2027];

  var holidaySet = new Set(HOLIDAYS);
  var earlySet = new Set(EARLY_CLOSES);

  /* ---- Time helpers ---- */

  var partsFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // Wall-clock parts in New York for a UTC timestamp (ms).
  function etParts(ms) {
    var o = {};
    partsFormat.formatToParts(new Date(ms)).forEach(function (p) {
      o[p.type] = p.value;
    });
    return {
      y: +o.year,
      mo: +o.month,
      d: +o.day,
      h: +o.hour % 24,
      mi: +o.minute,
      s: +o.second
    };
  }

  // New York's offset from UTC at a given instant, in ms (negative).
  function offsetMs(ms) {
    var p = etParts(ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }

  // The UTC timestamp of a New York wall-clock time.
  function etToUtc(y, mo, d, h, mi) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    return guess - offsetMs(guess);
  }

  function dayKey(y, mo, d) {
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  function isTradingDay(y, mo, d) {
    var dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !holidaySet.has(dayKey(y, mo, d));
  }

  // Open and close timestamps for one New York calendar day, or null.
  function sessionFor(y, mo, d) {
    if (!isTradingDay(y, mo, d)) return null;
    var close = earlySet.has(dayKey(y, mo, d)) ? EARLY : CLOSE;
    return {
      open: etToUtc(y, mo, d, OPEN.h, OPEN.m),
      close: etToUtc(y, mo, d, close.h, close.m),
      early: close === EARLY
    };
  }

  // Is the NYSE open now, and when does that next change?
  function marketState(nowMs) {
    var p = etParts(nowMs);
    if (COVERED_YEARS.indexOf(p.y) === -1) return { known: false };

    var base = Date.UTC(p.y, p.mo - 1, p.d);
    for (var i = 0; i < 12; i++) {
      var day = new Date(base + i * 86400000);
      var y = day.getUTCFullYear();
      if (COVERED_YEARS.indexOf(y) === -1) return { known: false };
      var s = sessionFor(y, day.getUTCMonth() + 1, day.getUTCDate());
      if (s && nowMs < s.close) {
        if (nowMs >= s.open) {
          return { known: true, open: true, closesAt: s.close, early: s.early };
        }
        return { known: true, open: false, opensAt: s.open };
      }
    }
    return { known: false };
  }

  /* ---- Formatting ---- */

  function duration(ms) {
    var total = Math.max(1, Math.ceil(ms / 60000));
    var days = Math.floor(total / 1440);
    var hours = Math.floor((total % 1440) / 60);
    var mins = total % 60;
    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + mins + "m";
    return mins + "m";
  }

  var timeOfDay = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit"
  });
  var weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long"
  });
  var clockFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZoneName: "short"
  });

  function whenLabel(targetMs, nowMs) {
    var t = etParts(targetMs);
    var n = etParts(nowMs);
    var diff = Math.round(
      (Date.UTC(t.y, t.mo - 1, t.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000
    );
    var day = diff === 0 ? "today" : diff === 1 ? "tomorrow" : weekdayName.format(new Date(targetMs));
    return day + " at " + timeOfDay.format(new Date(targetMs)) + " ET";
  }

  function statusText(state, nowMs) {
    if (!state.known) return "";
    if (state.open) {
      var when = timeOfDay.format(new Date(state.closesAt)) + " ET";
      var lead = state.early
        ? "The NYSE is open and closes early today at "
        : "The NYSE is open. Regular trading ends at ";
      return lead + when + ", in " + duration(state.closesAt - nowMs) + ".";
    }
    return "The NYSE is closed. It opens " + whenLabel(state.opensAt, nowMs) +
      ", in " + duration(state.opensAt - nowMs) + ".";
  }

  /* ---- Page ---- */

  function start() {
    var timeEl = document.getElementById("time");
    var statusEl = document.getElementById("status");
    var statusTextEl = document.getElementById("status-text");
    var sessionEl = document.getElementById("session");
    var nowEl = document.getElementById("now");
    var placeEl = document.getElementById("place");
    var stripEl = document.getElementById("strip");
    var yearEl = document.getElementById("year");
    var contactEl = document.getElementById("contact");
    var contactLink = document.getElementById("contact-link");

    if (CONTACT_EMAIL) {
      contactLink.href = "mailto:" + CONTACT_EMAIL;
      contactLink.textContent = CONTACT_EMAIL;
      contactEl.hidden = false;
    }

    function tick() {
      var now = Date.now();
      var p = etParts(now);

      // Clock: "10:55:12" plus a small "PM".
      var pieces = clockFormat.formatToParts(new Date(now));
      var hms = [];
      var ampm = "";
      var zone = "";
      pieces.forEach(function (x) {
        if (x.type === "hour" || x.type === "minute" || x.type === "second") hms.push(x.value);
        if (x.type === "dayPeriod") ampm = x.value;
        if (x.type === "timeZoneName") zone = x.value;
      });
      timeEl.firstChild.nodeValue = hms[0] + ":" + hms[1] + ":" + hms[2];
      timeEl.querySelector(".ampm").textContent = ampm;
      placeEl.textContent = "New York (" + zone + ")";

      // Status sentence.
      var state = marketState(now);
      if (state.known) {
        statusEl.setAttribute("data-state", state.open ? "open" : "closed");
        statusTextEl.textContent = statusText(state, now);
      } else {
        statusEl.removeAttribute("data-state");
        statusTextEl.textContent = "Market hours are not available for this date.";
      }

      // 24-hour strip: shaded session and the marker for now.
      var secs = p.h * 3600 + p.mi * 60 + p.s;
      nowEl.style.left = (secs / 86400) * 100 + "%";

      var s = state.known ? sessionFor(p.y, p.mo, p.d) : null;
      if (s) {
        var o = etParts(s.open);
        var c = etParts(s.close);
        var startPct = ((o.h * 3600 + o.mi * 60) / 86400) * 100;
        var endPct = ((c.h * 3600 + c.mi * 60) / 86400) * 100;
        sessionEl.style.left = startPct + "%";
        sessionEl.style.width = endPct - startPct + "%";
        sessionEl.classList.remove("is-off");
        stripEl.setAttribute(
          "aria-label",
          "A 24-hour day in New York. The NYSE session runs from " +
            timeOfDay.format(new Date(s.open)) + " to " + timeOfDay.format(new Date(s.close)) +
            ". The current time is marked."
        );
      } else {
        sessionEl.classList.add("is-off");
        stripEl.setAttribute(
          "aria-label",
          "A 24-hour day in New York with the current time marked. The NYSE is not trading today."
        );
      }

      yearEl.textContent = String(p.y);

      // Run again just after the next whole second.
      setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    }

    tick();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  // Lets the market logic be tested outside a browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { marketState: marketState, statusText: statusText, sessionFor: sessionFor };
  }
})();
