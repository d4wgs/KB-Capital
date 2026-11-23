"use strict";
(() => {
  const note = document.createElement("div");
  note.id = "metric-explanation";
  note.className = "metric-note";
  note.setAttribute("role","tooltip");
  note.hidden = true;
  document.body.append(note);
  let active, pinned;
  function close() {
    if (active) {
      active.setAttribute("aria-expanded","false");
      active.removeAttribute("aria-describedby");
    }
    active = pinned = null;
    note.hidden = true;
  }
  function show(button) {
    if (active !== button) close();
    active = button;
    note.textContent = button.dataset.help;
    note.hidden = false;
    const rect = button.getBoundingClientRect();
    note.style.left = Math.max(8, Math.min(rect.left,innerWidth-note.offsetWidth-8))+"px";
    note.style.top = (rect.bottom+note.offsetHeight+8 > innerHeight ? Math.max(8,rect.top-note.offsetHeight-6) : rect.bottom+6)+"px";
    button.setAttribute("aria-expanded","true");
    button.setAttribute("aria-describedby",note.id);
  }
  for (const button of document.querySelectorAll("button[data-help]")) {
    button.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") show(button); });
    button.addEventListener("pointerleave", () => { if (!pinned && document.activeElement !== button) close(); });
    button.addEventListener("focus", () => show(button));
    button.addEventListener("blur",close);
    button.addEventListener("click", () => { if (pinned === button) close(); else { show(button); pinned = button; } });
  }
  document.addEventListener("pointerdown", e => { if (active && !active.contains(e.target)) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  window.addEventListener("resize",close);
  window.addEventListener("scroll",close,{passive:true});
})();
