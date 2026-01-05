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

let items = [];
let pendingMemory = null;

let BASE_TS = null;          // stable for the whole session
let isBusy = false;          // prevents multi-tap duplicates during upload/sync
let awaitingSync = null;     // { fileName, tag, sortTs, y, previewEl, attempts, timerId }

// ---- UI ----
function toast(msg, ms = 1400) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl.__t);
  toastEl.__t = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function ensureWallWidthForX(x) {
  const min = 20000;
  const needed = Math.ceil(x + 700);
  const cur = wall.offsetWidth || min;
  const next = Math.max(cur, min, needed);
  wall.style.width = next + "px";
}

function formatDateLabel(s) {
  if (!s) return "";
  try {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return s;
  }
}

function toTs(dateStr) {
  if (!dateStr) return 0;
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function computeXFromDate(dateTs) {
  if (!BASE_TS) BASE_TS = dateTs || Date.now();
  const pxPerDay = 45;
  const paddingX = 200;
  const days = Math.round((dateTs - BASE_TS) / (1000 * 60 * 60 * 24));
  return Math.max(20, paddingX + days * pxPerDay);
}

function scrollToWallX(x, tapX = null) {
  const vw = viewport.clientWidth || 1;
  const target = tapX != null ? Math.max(0, x - tapX) : Math.max(0, x - vw * 0.5);
  viewport.scrollTo({ left: target, behavior: "smooth" });
}

// ---- Layout (anti-overlap lanes) ----
const CARD_W = 240;
const CARD_H = 320;          // approx total vertical footprint (image + label + padding)
const GAP_X  = 18;
const GAP_Y  = 26;

// Choose one of these modes:
const LAYOUT_MODE = "LANES"; // "LANES" recommended

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return !(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Find a y that doesn't overlap any existing item near this x.
// We only check items whose x is close enough to potentially overlap.
function pickFreeY(x, preferredY) {
  const topPad = 40;
  const bottomPad = 40;
  const wallH = wall.clientHeight || window.innerHeight;
  const yMin = topPad;
  const yMax = Math.max(yMin, wallH - CARD_H - bottomPad);

  const baseY = clamp(preferredY, yMin, yMax);

  // Only consider items that could collide horizontally
  const candidates = items.filter(it => Math.abs((it.x || 0) - x) < (CARD_W + GAP_X));

  // Try lanes around the preferred Y: 0, +1, -1, +2, -2...
  // Lane step = CARD_H + GAP_Y
  const step = CARD_H + GAP_Y;

  for (let k = 0; k < 60; k++) {
    const dir = (k === 0) ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
    const yTry = clamp(baseY + dir * step, yMin, yMax);

    let ok = true;
    for (const it of candidates) {
      if (rectsOverlap(x, yTry, CARD_W, CARD_H, it.x || 0, it.y || 0, CARD_W, CARD_H)) {
        ok = false;
        break;
      }
    }
    if (ok) return yTry;
  }

  // fallback: just clamp
  return baseY;
}

// ---- Drag-to-pan ----
let isPanning = false;
let panStartX = 0;
let panStartScrollLeft = 0;

viewport.addEventListener("pointerdown", (ev) => {
  if (pendingMemory || isBusy) return;
  if (ev.target && ev.target.closest && ev.target.closest(".photo")) return;

  isPanning = true;
  panStartX = ev.clientX;
  panStartScrollLeft = viewport.scrollLeft;

  try { viewport.setPointerCapture(ev.pointerId); } catch {}
  viewport.classList.add("grabbing");
}, { passive: true });

viewport.addEventListener("pointermove", (ev) => {
  if (!isPanning) return;
  const dx = ev.clientX - panStartX;
  viewport.scrollLeft = panStartScrollLeft - dx;
}, { passive: true });

function endPan(ev) {
  if (!isPanning) return;
  isPanning = false;
  viewport.classList.remove("grabbing");
  try { viewport.releasePointerCapture(ev.pointerId); } catch {}
}

viewport.addEventListener("pointerup", endPan, { passive: true });
viewport.addEventListener("pointercancel", endPan, { passive: true });
viewport.addEventListener("pointerleave", endPan, { passive: true });

// ---- GAS list via hidden iframe + postMessage ----
let gasFrame = null;

function ensureGasFrame() {
  if (gasFrame) return gasFrame;
  gasFrame = document.createElement("iframe");
  gasFrame.id = "gasFrame";
  gasFrame.style.display = "none";
  document.body.appendChild(gasFrame);
  return gasFrame;
}

function listViaIframe() {
  ensureGasFrame();
  gasFrame.src = `${GAS_URL}?action=list&pm=1&_=${Date.now()}`;
}

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || typeof data !== "object") return;

  if (data.ok && Array.isArray(data.items)) {
    renderFromList(data);
    return;
  }

  if (data.ok && (data.action === "upload" || data.action === "delete" || data.action === "update")) {
    setTimeout(listViaIframe, 400);
  }
});

function renderFromList(data) {
  items = (data.items || []).map((it) => {
    const takenDate = it.takenDate || it.taken_date || "";
    const sortTs = Number(it.sortTs || it.sort_ts || (takenDate ? toTs(takenDate) : 0));
    return {
      ...it,
      takenDate,
      sortTs,
      x: Number(it.x || 0),
      y: Number(it.y || 0),
      rot: Number(it.rot || 0),
      scale: Number(it.scale || 1),
    };
  });

  items.sort((a, b) => (a.sortTs || 0) - (b.sortTs || 0));

  // IMPORTANT: set BASE_TS ONCE only (never overwrite later)
  if (!BASE_TS) {
    const validTs = items.map(it => it.sortTs).filter(ts => ts && ts > 0 && Number.isFinite(ts));
    BASE_TS = validTs.length ? Math.min(...validTs) : Date.now();
  }

  for (const it of items) {
    const ts = it.sortTs || BASE_TS || Date.now();
    it.x = computeXFromDate(ts);
    if (!Number.isFinite(it.y) || it.y <= 0) it.y = 180;
  }

  const maxX = items.reduce((m, it) => Math.max(m, it.x || 0), 0);
  ensureWallWidthForX(maxX);

  // confirm last upload exists in list => then remove preview + unlock
  if (awaitingSync) {
    const found = items.some((it) =>
      String(it.fileName || "") === awaitingSync.fileName &&
      String(it.tag || "") === awaitingSync.tag &&
      Number(it.sortTs || 0) === Number(awaitingSync.sortTs || 0) &&
      Math.abs(Number(it.y || 0) - Number(awaitingSync.y || 0)) <= 2
    );

    if (found) {
      try { awaitingSync.previewEl.remove(); } catch {}
      clearTimeout(awaitingSync.timerId);
      awaitingSync = null;
      isBusy = false;
    }
  }

  wall.innerHTML = "";
  for (const it of items) wall.appendChild(makePhoto(it));

  // keep preview on top while awaiting sync
  if (awaitingSync && awaitingSync.previewEl && !awaitingSync.previewEl.isConnected) {
    wall.appendChild(awaitingSync.previewEl);
  }
}

function makePhoto(it) {
  const el = document.createElement("div");
  el.className = "photo";
  el.dataset.id = it.id;

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
    if (fid) img.src = `https://drive.google.com/thumbnail?id=${fid}&sz=w1000`;
  };

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = it.tag || "";

  frame.appendChild(img);
  frame.appendChild(tag);
  el.appendChild(frame);

  el.style.left = (it.x || 0) + "px";
  el.style.top = (it.y || 0) + "px";
  el.style.transform = `rotate(${it.rot || 0}deg) scale(${it.scale || 1})`;

  el.style.zIndex = String(100000 + Math.floor((it.sortTs || 0) / 86400000));

  return el;
}

// ---- Upload ----
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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function startSyncPolling() {
  if (!awaitingSync) return;
  clearTimeout(awaitingSync.timerId);

  const tick = () => {
    if (!awaitingSync) return;

    awaitingSync.attempts += 1;
    listViaIframe();

    // after ~30 seconds give up polling; KEEP preview (don’t remove it)
    if (awaitingSync.attempts >= 30) {
      toast("Saved. If it still doesn’t appear, refresh once.", 2400);
      isBusy = false;
      return;
    }

    awaitingSync.timerId = setTimeout(tick, 900);
  };

  awaitingSync.timerId = setTimeout(tick, 700);
}

// ---- Modal flow ----
makeMemoryBtn.addEventListener("click", () => {
  if (isBusy) return toast("Wait… saving the last one ❤️");
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
  if (isBusy) return toast("Wait… saving the last one ❤️");

  const f = memFile.files && memFile.files[0];
  const tag = (memTag.value || "").trim().slice(0, 60);
  const dateStr = memDate.value;

  if (!f) return alert("Choose an image.");
  if (!dateStr) return alert("Select the date the photo was taken.");

  const imageData = await readFileAsDataURL(f);

  pendingMemory = { fileName: f.name, tag, dateStr, imageData };

  modalOverlay.style.display = "none";
  toast("Tap anywhere on the wall to place it");
});

// ---- Place on wall ----
wall.addEventListener("pointerdown", async (ev) => {
  if (!pendingMemory) return;
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
  const preferredY = Math.max(10, Math.round(tapY - 120));
  const y = (LAYOUT_MODE === "LANES") ? pickFreeY(x, preferredY) : preferredY;

  scrollToWallX(x, tapX);
  ensureWallWidthForX(x);

  const preview = document.createElement("div");
  preview.className = "photo";
  preview.style.left = x + "px";
  preview.style.top = y + "px";
  preview.style.opacity = "0.98";
  preview.style.pointerEvents = "none";
  preview.innerHTML = `
    <div class="dateLabel">${formatDateLabel(mem.dateStr)}</div>
    <div class="frame">
      <img src="${mem.imageData}" draggable="false" />
      <div class="tag">${mem.tag || ""}</div>
    </div>
  `;
  wall.appendChild(preview);

  awaitingSync = {
    fileName: mem.fileName,
    tag: mem.tag,
    sortTs: dateTs,
    y: y,
    previewEl: preview,
    attempts: 0,
    timerId: null
  };

  toast("Uploading…");

  try {
    await postUpload({
      fileName: mem.fileName,
      tag: mem.tag,
      imageData: mem.imageData,
      x, y,
      rot: 0,
      scale: 1,
      taken_date: mem.dateStr,
      sort_ts: dateTs
    });
    toast("Saved ❤️");
  } catch {
    toast("Saved. If it disappears, refresh.", 2200);
  }

  memTag.value = "";
  memDate.value = "";
  memFile.value = "";

  startSyncPolling();
}, { passive: false });

// initial load
listViaIframe();