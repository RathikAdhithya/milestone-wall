const APP_VER = "2026-01-05_iframe_list_v4";
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

let items = [];
let pendingMemory = null;

let BASE_TS = null;
let isBusy = false;
let wallLoaded = false;

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

function formatDateLabel(s) {
  if (!s) return "";
  try {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch { return s; }
}

function toTs(dateStr) {
  if (!dateStr) return 0;
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function computeXFromDate(dateTs) {
  if (!BASE_TS) BASE_TS = dateTs || Date.now();
  const days = Math.round((dateTs - BASE_TS) / 86400000);
  return Math.max(20, PADDING_X + days * PX_PER_DAY);
}

function scrollToWallX(x, tapX = null) {
  const vw = viewport.clientWidth || 1;
  const target = tapX != null ? Math.max(0, x - tapX) : Math.max(0, x - vw * 0.35);
  viewport.scrollTo({ left: target, behavior: "smooth" });
}

// -----------------------
// DRAG TO PAN
// -----------------------
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

// -----------------------
// LIST VIA JSONP (works on GitHub Pages)
// -----------------------
function listViaJsonp() {
  const cb = "__mw_list_cb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const s = document.createElement("script");

  window[cb] = (data) => {
    try {
      if (data && data.ok && Array.isArray(data.items)) {
        wallLoaded = true;
        renderFromList(data.items);
      } else {
        toast("Failed to load wall", 1800);
      }
    } finally {
      try { delete window[cb]; } catch {}
      try { s.remove(); } catch {}
    }
  };

  s.src = `${GAS_URL}?action=list&callback=${encodeURIComponent(cb)}&_=${Date.now()}`;
  s.onerror = () => {
    try { delete window[cb]; } catch {}
    toast("Failed to load wall", 1800);
    try { s.remove(); } catch {}
  };

  document.body.appendChild(s);
}

// -----------------------
// RENDER (accept snake_case + camelCase)
// -----------------------
function normalizeItem(it) {
  const id = String(it.id || "");
  const fileId = String(it.fileId || it.file_id || "");
  const fileName = String(it.fileName || it.file_name || "");
  const tag = String(it.tag || "");
  const createdAt = String(it.createdAt || it.created_at || "");

  const takenDate = String(it.takenDate || it.taken_date || "");
  let sortTs = Number(it.sortTs || it.sort_ts || 0) || 0;

  // fallback: created_at
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
  items = (rawItems || []).map(normalizeItem).filter(it => it.id && it.fileId);

  // establish BASE_TS once
  if (!BASE_TS) {
    const valid = items.map(i => i.sortTs).filter(ts => ts && ts > 0);
    BASE_TS = valid.length ? Math.min(...valid) : Date.now();
  }

  for (const it of items) {
    if (!it.takenDate && it.sortTs) it.takenDate = new Date(it.sortTs).toISOString().slice(0,10);
    if (!Number.isFinite(it.x) || it.x <= 0) it.x = computeXFromDate(it.sortTs || BASE_TS);
    if (!Number.isFinite(it.y) || it.y <= 0) it.y = 180;
  }

  items.sort((a,b)=> (a.sortTs||0)-(b.sortTs||0));

  const maxX = items.reduce((m, it) => Math.max(m, it.x || 0), 0);
  ensureWallWidthForX(maxX);

  wall.innerHTML = "";
  for (const it of items) wall.appendChild(makePhoto(it));

  // scroll near first item
  if (items.length) {
    const minX = items.reduce((m, it) => Math.min(m, it.x || 0), Infinity);
    viewport.scrollLeft = Math.max(0, minX - (viewport.clientWidth || 1) * 0.25);
  }
}

function makePhoto(it) {
  const el = document.createElement("div");
  el.className = "photo";
  el.dataset.id = it.id;

  el.style.zIndex = String(100000 + Math.floor((it.sortTs || 0) / 86400000));

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

  el.style.left = (it.x || 0) + "px";
  el.style.top = (it.y || 0) + "px";
  el.style.transform = `rotate(${it.rot || 0}deg) scale(${it.scale || 1})`;

  return el;
}

// -----------------------
// UPLOAD
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
// MODAL FLOW
// -----------------------
makeMemoryBtn.addEventListener("click", () => {
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
// PLACE ON WALL (single-tap only)
// -----------------------
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
  const y = Math.max(10, Math.round(tapY - 120));

  scrollToWallX(x, tapX);
  ensureWallWidthForX(x);

  // instant preview
  const preview = document.createElement("div");
  preview.className = "photo";
  preview.style.left = x + "px";
  preview.style.top = y + "px";
  preview.style.opacity = "0.98";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "999999";
  preview.innerHTML = `
    <div class="dateLabel">${formatDateLabel(mem.dateStr)}</div>
    <div class="frame">
      <img src="${mem.imageData}" draggable="false" />
      <div class="tag">${mem.tag || ""}</div>
    </div>
  `;
  wall.appendChild(preview);

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
    listViaJsonp();
    setTimeout(() => { try { preview.remove(); } catch {} }, 1200);
    isBusy = false;
  }, 900);
}, { passive: false });

// initial load

listViaJsonp();