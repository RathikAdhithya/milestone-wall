const APP_VER = "2026-01-06_free_pan_drag_snap_details_v2_smooth";
console.log("Milestone Wall loaded:", APP_VER);

const GAS_URL = "https://script.google.com/macros/s/AKfycbwAMAZkN1d4-xBG6bID8kyWCeNKSfKX29STFo_wipVxQFojmBP1jOvnWXKRrx1tvS6D7g/exec";
const UPLOAD_KEY = "kR9!v3QpZx_2Gm7WASJKH972634!98762";

const wall = document.getElementById("wall");
const viewport = document.getElementById("viewport");

const makeMemoryBtn = document.getElementById("makeMemoryBtn");
const modalOverlay = document.getElementById("modalOverlay");
const memTag = document.getElementById("memTag");
const memDate = document.getElementById("memDate");
const memFile = document.getElementById("memFile");
const memHint = document.getElementById("memHint");
const memCancel = document.getElementById("memCancel");
const memPlace = document.getElementById("memPlace");
const toastEl = document.getElementById("toast");

// Details modal
const detailOverlay = document.getElementById("detailOverlay");
const detImg = document.getElementById("detImg");
const detTag = document.getElementById("detTag");
const detDate = document.getElementById("detDate");
const detHint = document.getElementById("detHint");
const detFileName = document.getElementById("detFileName");
const detCreatedAt = document.getElementById("detCreatedAt");
const detId = document.getElementById("detId");
const detOpen = document.getElementById("detOpen");
const detSave = document.getElementById("detSave");
const detDelete = document.getElementById("detDelete");
const detClose = document.getElementById("detClose");
const detDatePill = document.getElementById("detDatePill");

// Snap config
const SNAP_Y = 20;
const X_SNAP_THRESHOLD = 30;
const TAP_SLOP = 7; // px; tap vs drag threshold

const pendingPreviews = new Map();

let items = [];
let pendingMemory = null;

let BASE_TS = null;
let isBusy = false;
let wallLoaded = false;
let detailsOpen = false;

let selected = null; // { it, el }

// spacing so consecutive dates never overlap
const CARD_W = 240;
const GAP_X  = 80;
const PX_PER_DAY = CARD_W + GAP_X;
const PADDING_X = 240;

function toast(msg, ms = 1400) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl.__t);
  toastEl.__t = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function ensureWallWidthForX(x) {
  const min = 20000;
  const needed = Math.ceil(x + 900);
  const cur = wall.offsetWidth || min;
  wall.style.width = Math.max(cur, min, needed) + "px";
}

function ensureWallHeightForY(y) {
  const min = 2400;
  const needed = Math.ceil(y + 500);
  const cur = wall.offsetHeight || min;
  wall.style.height = Math.max(cur, min, needed) + "px";
}

function formatDateLabel(s) {
  if (!s) return "";
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
    }
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      const d = new Date(n);
      return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return "Invalid Date";
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  } catch {
    return "Invalid Date";
  }
}

function toTs(dateStr) {
  if (!dateStr) return 0;
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function isoFromTs(ts) {
  try { return new Date(ts).toISOString().slice(0,10); } catch { return ""; }
}

function computeXFromDate(dateTs) {
  const base = BASE_TS || (dateTs || Date.now());
  const days = Math.floor((dateTs - base) / 86400000);
  return Math.max(20, PADDING_X + days * PX_PER_DAY);
}

function scrollToWallX(x, tapX = null) {
  const vw = viewport.clientWidth || 1;
  const target = tapX != null ? Math.max(0, x - tapX) : Math.max(0, x - vw * 0.35);
  viewport.scrollTo({ left: target, behavior: "smooth" });
}

// helpers
function dayIndexFromX(x) {
  return Math.round((x - PADDING_X) / PX_PER_DAY);
}
function snapXToDayIndex(dayIdx) {
  return Math.max(20, PADDING_X + dayIdx * PX_PER_DAY);
}
function dateFromDayIndex(dayIdx) {
  const ts = (BASE_TS || Date.now()) + dayIdx * 86400000;
  const d = new Date(ts);
  const iso = d.toISOString().slice(0, 10);
  return { ts, iso };
}
function snapY(y) {
  const maxY = Math.max(2000, (wall.offsetHeight || 2400) - 280);
  const sy = Math.round(y / SNAP_Y) * SNAP_Y;
  return Math.max(10, Math.min(maxY, sy));
}

function findElById_(id) {
  return wall.querySelector(`.photo[data-id="${CSS.escape(String(id))}"]`);
}

/** POSITIONING: use GPU transforms instead of left/top */
function setCardTransform_(el, x, y, rot = 0, scale = 1) {
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${rot}deg) scale(${scale})`;
}
function setCardZ_(el, sortTs) {
  el.style.zIndex = String(100000 + Math.floor((sortTs || 0) / 86400000));
}

// -----------------------
// FREE PAN (X + Y) ON EMPTY SPACE
// -----------------------
let isPanning = false;
let panPointerId = null;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;

function canPanStart_(ev) {
  if (detailsOpen) return false;
  if (pendingMemory || isBusy) return false;
  if (drag && drag.active) return false;
  if (ev.target && ev.target.closest && ev.target.closest(".photo")) return false;
  return true;
}

function panStart_(ev) {
  if (!canPanStart_(ev)) return;
  isPanning = true;
  panPointerId = ev.pointerId;
  panStartX = ev.clientX;
  panStartY = ev.clientY;
  panStartScrollLeft = viewport.scrollLeft;
  panStartScrollTop = viewport.scrollTop;
  try { viewport.setPointerCapture(ev.pointerId); } catch {}
  viewport.classList.add("grabbing");
  ev.preventDefault();
}
function panMove_(ev) {
  if (!isPanning || ev.pointerId !== panPointerId) return;
  const dx = ev.clientX - panStartX;
  const dy = ev.clientY - panStartY;
  viewport.scrollLeft = panStartScrollLeft - dx;
  viewport.scrollTop  = panStartScrollTop  - dy;
  ev.preventDefault();
}
function panEnd_(ev) {
  if (!isPanning || ev.pointerId !== panPointerId) return;
  isPanning = false;
  panPointerId = null;
  viewport.classList.remove("grabbing");
  try { viewport.releasePointerCapture(ev.pointerId); } catch {}
  ev.preventDefault();
}
viewport.addEventListener("pointerdown", panStart_, { passive: false });
window.addEventListener("pointermove", panMove_, { passive: false });
window.addEventListener("pointerup", panEnd_, { passive: false });
window.addEventListener("pointercancel", panEnd_, { passive: false });

// -----------------------
// DRAG PHOTO (snap Y + snap date column)
// TAP PHOTO -> open details modal
// -----------------------
let drag = null;

function openDetails_(it) {
  if (!it) return;
  detailsOpen = true;

  const el = findElById_(it.id);
  selected = { it, el };

  detImg.src = it.imgUrl || "";
  detTag.value = (it.tag || "").slice(0,60);

  const dISO = it.takenDate || (it.sortTs ? isoFromTs(it.sortTs) : "");
  detDate.value = dISO || "";

  detDatePill.textContent = formatDateLabel(detDate.value || dISO);
  detHint.textContent = "";

  detFileName.textContent = it.fileName || it.file_name || "—";
  detCreatedAt.textContent = it.createdAt || it.created_at || "—";
  detId.textContent = it.id || "—";

  detailOverlay.style.display = "flex";
}

function closeDetails_() {
  detailsOpen = false;
  selected = null;
  detailOverlay.style.display = "none";
}

function updateDetailsHint_() {
  if (!selected || !selected.it) return;
  const dateStr = detDate.value;
  if (!dateStr) {
    detHint.textContent = "Pick a date to move it to another column.";
    detDatePill.textContent = "—";
    return;
  }
  const ts = toTs(dateStr);
  const x = computeXFromDate(ts);
  const dayIdx = dayIndexFromX(x);
  const { iso } = dateFromDayIndex(dayIdx);
  detDatePill.textContent = formatDateLabel(iso);
  detHint.textContent = `Will snap to: ${formatDateLabel(iso)}`;
}

detailOverlay.addEventListener("click", (e) => {
  if (e.target === detailOverlay) closeDetails_();
});
detClose.addEventListener("click", closeDetails_);
detDate.addEventListener("change", updateDetailsHint_);

detOpen.addEventListener("click", () => {
  if (!selected || !selected.it) return;
  const url = selected.it.imgUrl || "";
  if (url) window.open(url, "_blank");
});

detSave.addEventListener("click", async () => {
  if (!selected || !selected.it) return;
  if (isBusy) return toast("Wait… saving ❤️");
  isBusy = true;

  const it = selected.it;
  const el = selected.el || findElById_(it.id);

  const newTag = (detTag.value || "").trim().slice(0,60);
  const newDateStr = detDate.value;

  if (!newDateStr) {
    isBusy = false;
    return toast("Select a date", 1600);
  }

  const newTs = toTs(newDateStr);
  const newX = computeXFromDate(newTs);
  const newY = snapY(Number(it.y || 180));

  it.tag = newTag;
  it.takenDate = newDateStr;
  it.sortTs = newTs;
  it.x = newX;
  it.y = newY;

  if (el) {
    setCardTransform_(el, newX, newY, it.rot || 0, it.scale || 1);
    setCardZ_(el, newTs);

    const tagEl = el.querySelector(".tag");
    if (tagEl) tagEl.textContent = newTag;

    const dateEl = el.querySelector(".dateLabel");
    if (dateEl) dateEl.textContent = formatDateLabel(newDateStr);
  }

  ensureWallWidthForX(newX);
  ensureWallHeightForY(newY);
  scrollToWallX(newX);

  try {
    await postUpdate({
      id: it.id,
      tag: newTag,
      x: newX,
      y: newY,
      taken_date: newDateStr,
      takenDate: newDateStr,
      sort_ts: newTs,
      sortTs: newTs
    });
    toast("Saved ❤️");
  } catch {
    toast("Saved (refresh if needed)", 2000);
  }

  isBusy = false;
  closeDetails_();
  // no forced refresh; no flicker
});

detDelete.addEventListener("click", async () => {
  if (!selected || !selected.it) return;
  if (isBusy) return toast("Wait…");
  const it = selected.it;

  if (!confirm("Delete this memory?")) return;

  isBusy = true;
  try {
    await postDelete(it.id);
  } catch {}

  // remove locally
  items = items.filter(x => x.id !== it.id);
  const el = selected.el || findElById_(it.id);
  try { if (el) el.remove(); } catch {}

  toast("Deleted 🗑️");
  isBusy = false;
  closeDetails_();
  // optional: refresh list; but our renderer is diff-based, so no blink
  setTimeout(() => listViaJsonp(), 350);
});

// rAF throttle for drag movement
function scheduleDragPaint_() {
  if (!drag || drag.__raf) return;
  drag.__raf = requestAnimationFrame(() => {
    if (!drag) return;

    const sx = drag.__pendingX;
    const sy = drag.__pendingY;
    const dayIdx = drag.__pendingDayIdx;

    drag.curDayIdx = dayIdx;
    drag.curX = sx;
    drag.curY = sy;

    setCardTransform_(drag.el, sx, sy, drag.it.rot || 0, drag.it.scale || 1);

    const { iso } = dateFromDayIndex(dayIdx);
    const dateEl = drag.el.querySelector(".dateLabel");
    if (dateEl) dateEl.textContent = formatDateLabel(iso);

    ensureWallWidthForX(sx);
    ensureWallHeightForY(sy);

    drag.__raf = 0;
  });
}

wall.addEventListener("pointerdown", (ev) => {
  if (detailsOpen) return;
  if (pendingMemory || isBusy) return;

  const card = ev.target && ev.target.closest ? ev.target.closest(".photo[data-id]") : null;
  if (!card) return;

  const id = String(card.dataset.id || "");
  const it = items.find(x => x.id === id);
  if (!it) return;

  drag = {
    id,
    it,
    el: card,
    pointerId: ev.pointerId,
    startClientX: ev.clientX,
    startClientY: ev.clientY,
    startX: Number(it.x || 0),
    startY: Number(it.y || 0),
    startDayIdx: dayIndexFromX(Number(it.x || 0)),
    curDayIdx: dayIndexFromX(Number(it.x || 0)),
    curX: Number(it.x || 0),
    curY: Number(it.y || 0),
    active: false,

    __raf: 0,
    __pendingX: Number(it.x || 0),
    __pendingY: Number(it.y || 0),
    __pendingDayIdx: dayIndexFromX(Number(it.x || 0)),
  };

  try { card.setPointerCapture(ev.pointerId); } catch {}
  ev.preventDefault();
  ev.stopPropagation();
}, { passive: false });

wall.addEventListener("pointermove", (ev) => {
  if (!drag || ev.pointerId !== drag.pointerId) return;

  const dx = ev.clientX - drag.startClientX;
  const dy = ev.clientY - drag.startClientY;

  if (!drag.active) {
    if (Math.hypot(dx, dy) < TAP_SLOP) return;
    drag.active = true;
    drag.el.classList.add("dragging");
    drag.el.style.zIndex = "999999";
  }

  let dayIdx = drag.startDayIdx;
  if (Math.abs(dx) > X_SNAP_THRESHOLD) {
    dayIdx = dayIndexFromX(drag.startX + dx);
  }

  const sx = snapXToDayIndex(dayIdx);
  const sy = snapY(drag.startY + dy);

  drag.__pendingDayIdx = dayIdx;
  drag.__pendingX = sx;
  drag.__pendingY = sy;

  scheduleDragPaint_();

  ev.preventDefault();
}, { passive: false });

async function finishDrag_(ev, canceled = false) {
  if (!drag) return;

  const d = drag;
  drag = null;

  try { d.el.releasePointerCapture(ev.pointerId); } catch {}
  if (d.__raf) { try { cancelAnimationFrame(d.__raf); } catch {} }

  // TAP -> open details
  if (!d.active) {
    openDetails_(d.it);
    return;
  }

  d.el.classList.remove("dragging");

  const { ts, iso } = dateFromDayIndex(d.curDayIdx);

  d.it.x = d.curX;
  d.it.y = d.curY;
  d.it.sortTs = ts;
  d.it.takenDate = iso;

  setCardZ_(d.el, ts);

  // keep final snapped transform (ensures we animate into place if last paint lagged)
  setCardTransform_(d.el, d.curX, d.curY, d.it.rot || 0, d.it.scale || 1);

  try {
    await postUpdate({
      id: d.id,
      x: d.curX,
      y: d.curY,
      taken_date: iso,
      takenDate: iso,
      sort_ts: ts,
      sortTs: ts
    });
    toast("Updated ❤️");
  } catch {
    toast("Moved (refresh if needed)", 2000);
  }

  // IMPORTANT: no auto list refresh here → no flicker
  // If you still want occasional sync, do it on a timer elsewhere.
  if (canceled) setTimeout(() => listViaJsonp(), 400);
}
wall.addEventListener("pointerup", (ev) => finishDrag_(ev, false), { passive: false });
wall.addEventListener("pointercancel", (ev) => finishDrag_(ev, true), { passive: false });

// -----------------------
// LIST VIA JSONP (GitHub Pages friendly)
// -----------------------
function listViaJsonp(retry = 0) {
  const cb = "__mw_list_cb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const s = document.createElement("script");

  let done = false;
  function cleanup() {
    try { delete window[cb]; } catch {}
    try { s.remove(); } catch {}
  }

  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    cleanup();
    toast("Wall load timed out. Try Incognito/Private tab.", 2600);
    if (retry < 2) setTimeout(() => listViaJsonp(retry + 1), 700);
  }, 6000);

  window[cb] = (data) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cleanup();

    if (data && data.ok && Array.isArray(data.items)) {
      wallLoaded = true;
      renderFromList(data.items);
    } else {
      toast("Failed to load wall (bad response).", 2400);
      console.log("list bad response:", data);
    }
  };

  s.src = `${GAS_URL}?action=list&callback=${encodeURIComponent(cb)}&_=${Date.now()}`;
  s.onerror = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cleanup();
    toast("Wall blocked by privacy/adblock. Use Incognito/Private tab.", 2600);
    if (retry < 2) setTimeout(() => listViaJsonp(retry + 1), 900);
  };

  document.body.appendChild(s);
}

// -----------------------
// RENDER (DIFF UPDATE, NO BLINK)
// -----------------------
function normalizeItem(it) {
  const id = String(it.id || "");
  const fileId = String(it.fileId || it.file_id || "");
  const fileName = String(it.fileName || it.file_name || "");
  const tag = String(it.tag || "");
  const createdAt = String(it.createdAt || it.created_at || "");

  const takenDate = String(it.takenDate || it.taken_date || "");
  let sortTs = Number(it.sortTs || it.sort_ts || 0) || 0;

  if (!sortTs && createdAt) {
    const ts = Date.parse(createdAt);
    sortTs = Number.isFinite(ts) ? ts : 0;
  }

  const x = Number(it.x);
  const y = Number(it.y);

  const rot = Number(it.rot || 0);
  const scale = Number(it.scale || 1);
  const imgUrl = String(it.imgUrl || it.img_url || (fileId ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}` : ""));

  return { id, fileId, fileName, tag, createdAt, takenDate, sortTs, x, y, rot, scale, imgUrl };
}

function renderFromList(rawItems) {
  const next = (rawItems || []).map(normalizeItem).filter(it => it.id && it.fileId);

  const valid = next.map(i => i.sortTs).filter(ts => ts && ts > 0);
  BASE_TS = valid.length ? Math.min(...valid) : (BASE_TS || Date.now());

  for (const it of next) {
    if (!it.takenDate && it.sortTs) it.takenDate = new Date(it.sortTs).toISOString().slice(0,10);
    it.x = computeXFromDate(it.sortTs || BASE_TS);
    if (!Number.isFinite(it.y) || it.y <= 0) it.y = 180;
  }

  next.sort((a,b)=> (a.sortTs||0)-(b.sortTs||0));

  const maxX = next.reduce((m, it) => Math.max(m, it.x || 0), 0);
  const maxY = next.reduce((m, it) => Math.max(m, it.y || 0), 0);
  ensureWallWidthForX(maxX);
  ensureWallHeightForY(maxY);

  const existingEls = new Map(
    Array.from(wall.querySelectorAll(".photo[data-id]")).map(el => [String(el.dataset.id || ""), el])
  );
  const nextIds = new Set(next.map(it => it.id));

  // remove missing
  for (const [id, el] of existingEls) {
    if (!nextIds.has(id)) {
      try { el.remove(); } catch {}
      existingEls.delete(id);
    }
  }

  // upsert (no wall.innerHTML reset)
  for (const it of next) {
    let el = existingEls.get(it.id);

    // If it doesn't exist yet, try to adopt a pending preview by clientId
    if (!el) {
      const cid = String(it.clientId || it.client_id || "");
      const pending = cid ? pendingPreviews.get(cid) : null;

      if (pending && pending.isConnected && pending.classList.contains("pending")) {
        el = pending;

        // Convert preview -> real
        el.classList.remove("preview", "pending");
        el.dataset.id = it.id;
        delete el.dataset.clientId;

        pendingPreviews.delete(cid);
        existingEls.set(it.id, el);

        // Update tag/date
        const dateEl = el.querySelector(".dateLabel");
        if (dateEl) dateEl.textContent = formatDateLabel(it.takenDate);

        const tagEl = el.querySelector(".tag");
        if (tagEl) tagEl.textContent = it.tag || "";

        // Swap image ONLY after Drive URL loads (prevents flash)
        const img = el.querySelector("img");
        if (img) {
          const targetSrc = it.imgUrl;
          if (targetSrc && img.src !== targetSrc) {
            const pre = new Image();
            pre.onload = () => { img.src = targetSrc; };
            pre.src = targetSrc;
          }
        }

        // Position/z-index
        setCardZ_(el, it.sortTs || 0);
        setCardTransform_(el, it.x || 0, it.y || 0, it.rot || 0, it.scale || 1);

        continue; // done
      }

      // If no pending preview matches, create normally
      el = makePhoto(it);
      wall.appendChild(el);
      existingEls.set(it.id, el);
      continue;
    }

    // Update existing element in place
    setCardZ_(el, it.sortTs || 0);
    setCardTransform_(el, it.x || 0, it.y || 0, it.rot || 0, it.scale || 1);

    const dateEl = el.querySelector(".dateLabel");
    if (dateEl) dateEl.textContent = formatDateLabel(it.takenDate);

    const tagEl = el.querySelector(".tag");
    if (tagEl) tagEl.textContent = it.tag || "";

    const img = el.querySelector("img");
    if (img && it.imgUrl && img.src !== it.imgUrl) img.src = it.imgUrl;
  }

  items = next;

  // initial scroll only on first load
  if (items.length && !renderFromList.__didInitialScroll) {
    const minX = items.reduce((m, it) => Math.min(m, it.x || 0), Infinity);
    viewport.scrollLeft = Math.max(0, minX - (viewport.clientWidth || 1) * 0.25);
    renderFromList.__didInitialScroll = true;
  }
}

function makePhoto(it) {
  const el = document.createElement("div");
  el.className = "photo";
  el.dataset.id = it.id;

  setCardZ_(el, it.sortTs || 0);

  const date = document.createElement("div");
  date.className = "dateLabel";
  date.textContent = formatDateLabel(it.takenDate);
  el.appendChild(date);

  const frame = document.createElement("div");
  frame.className = "frame";

  const img = document.createElement("img");
  img.src = it.imgUrl;
  img.draggable = false;
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = () => {
    const fid = encodeURIComponent(it.fileId || "");
    if (fid) img.src = `https://drive.google.com/thumbnail?id=${fid}&sz=w1200`;
  };

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = it.tag || "";

  frame.appendChild(img);
  frame.appendChild(tag);
  el.appendChild(frame);

  setCardTransform_(el, it.x || 0, it.y || 0, it.rot || 0, it.scale || 1);

  return el;
}

// -----------------------
// UPLOAD / UPDATE / DELETE
// -----------------------
async function postUpload(fields) {
  const p = new URLSearchParams();
  p.set("action", "upload");
  p.set("key", UPLOAD_KEY);
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    p.set(k, String(v));
  }
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: p });
}

async function postUpdate(fields) {
  const p = new URLSearchParams();
  p.set("action", "update");
  p.set("key", UPLOAD_KEY);
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    p.set(k, String(v));
  }
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: p });
}

async function postDelete(id) {
  const p = new URLSearchParams();
  p.set("action", "delete");
  p.set("key", UPLOAD_KEY);
  p.set("id", String(id));
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: p });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function newClientId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return "cid_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

// -----------------------
// CREATE MEMORY MODAL FLOW
// -----------------------
makeMemoryBtn.addEventListener("click", () => {
  if (detailsOpen) return;
  if (!wallLoaded) return toast("Loading wall… try again in a sec", 1600);
  if (isBusy) return toast("Wait… saving ❤️");

  modalOverlay.style.display = "flex";
  memHint.textContent = "Pick a photo + date, then click “Place on wall”.";
  pendingMemory = null;
});

memCancel.addEventListener("click", () => {
  modalOverlay.style.display = "none";
  pendingMemory = null;
});

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.style.display = "none";
    pendingMemory = null;
  }
});

memPlace.addEventListener("click", async () => {
  if (isBusy) return toast("Wait… saving ❤️");

  const f = memFile.files && memFile.files[0];
  const tag = (memTag.value || "").trim().slice(0, 60);
  const dateStr = memDate.value;

  if (!f) return alert("Choose an image.");
  if (!dateStr) return alert("Select the date the photo was taken.");

  const imageData = await readFileAsDataURL(f);

  pendingMemory = {
    clientId: newClientId(),
    fileName: f.name,
    tag,
    dateStr,
    imageData
  };

  modalOverlay.style.display = "none";
  toast("Tap anywhere on the wall to place it");
});

// -----------------------
// PLACE ON WALL (single-tap)
// -----------------------
wall.addEventListener("pointerdown", async (ev) => {
  if (!pendingMemory) return;
  if (detailsOpen) return;
  if (isBusy) return;

  isBusy = true;
  ev.preventDefault();
  ev.stopPropagation();

  const mem = pendingMemory;
  pendingMemory = null;

  const vrect = viewport.getBoundingClientRect();
  const tapX = ev.clientX - vrect.left;
  const tapY = ev.clientY - vrect.top;

  const dateTs = toTs(mem.dateStr) || Date.now();
  const x = computeXFromDate(dateTs);
  const y = Math.max(10, snapY(Math.round(tapY - 120)));

  scrollToWallX(x, tapX);
  ensureWallWidthForX(x);
  ensureWallHeightForY(y);

  const preview = document.createElement("div");
  preview.className = "photo preview pending";
  preview.dataset.clientId = mem.clientId;
  preview.style.zIndex = "999999";

  setCardTransform_(preview, x, y, 0, 1);

  preview.innerHTML = `
    <div class="dateLabel">${formatDateLabel(mem.dateStr)}</div>
    <div class="frame">
      <img src="${mem.imageData}" draggable="false" />
      <div class="tag">${mem.tag || ""}</div>
    </div>
  `;

  wall.appendChild(preview);
  pendingPreviews.set(mem.clientId, preview);

  toast("Uploading…");

  try {
    await postUpload({
      client_id: mem.clientId,
      file_name: mem.fileName,
      fileName: mem.fileName,
      tag: mem.tag,
      imageData: mem.imageData,
      x, y,
      rot: 0,
      scale: 1,
      taken_date: mem.dateStr,
      takenDate: mem.dateStr,
      sort_ts: dateTs,
      sortTs: dateTs
    });

    toast("Saved ❤️");
  } catch {
    toast("Saved. Refresh if needed.", 2000);
  }

  memTag.value = "";
  memDate.value = "";
  memFile.value = "";

  setTimeout(() => {
    listViaJsonp();   // this will convert preview -> real seamlessly
    isBusy = false;
  }, 250);

  // Safety cleanup if it never shows up (upload failed / list blocked)
  setTimeout(() => {
    const p = pendingPreviews.get(mem.clientId);
    if (p && p.isConnected && p.classList.contains("pending")) {
      try { p.remove(); } catch {}
      pendingPreviews.delete(mem.clientId);
      toast("Upload didn’t sync (try refresh)", 2000);
    }
  }, 30000);
}, { passive: false });

// initial load
listViaJsonp();