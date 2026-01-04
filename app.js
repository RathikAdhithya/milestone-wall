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

// stable base so X-from-date stays consistent during session
let BASE_TS = null;

// ---- UI helpers ----
function toast(msg, ms = 1400) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl.__t);
  toastEl.__t = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function ensureWallWidthForX(x) {
  const min = 20000;
  const needed = Math.ceil(x + 700); // padding on the right
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

// receive messages from GAS (list / upload / update / delete)
window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || typeof data !== "object") return;

  // list response (from listViaIframe pm=1)
  if (data.ok && Array.isArray(data.items)) {
    renderFromList(data);
    return;
  }

  // upload/update/delete response (if you ever use those via iframe later)
  if (data.ok && (data.action === "upload" || data.action === "delete" || data.action === "update")) {
    setTimeout(listViaIframe, 900);
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

  const firstValid = items.find((it) => it.sortTs && it.sortTs > 0);
  if (firstValid) BASE_TS = firstValid.sortTs;

  for (const it of items) {
    const ts = it.sortTs || BASE_TS || Date.now();
    it.x = computeXFromDate(ts); // chronological X
    if (!Number.isFinite(it.y) || it.y <= 0) it.y = 180;
  }

  const maxX = items.reduce((m, it) => Math.max(m, it.x || 0), 0);
  ensureWallWidthForX(maxX);

  wall.innerHTML = "";
  for (const it of items) wall.appendChild(makePhoto(it));
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

  // IMPORTANT: Drive uc?export=view sometimes fails; fallback to thumbnail
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

  return el;
}

// ---- POST upload (must use fetch; don’t use beacon for base64) ----
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

// ---- Modal flow ----
makeMemoryBtn.addEventListener("click", () => {
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
  const f = memFile.files && memFile.files[0];
  const tag = (memTag.value || "").trim().slice(0, 60);
  const dateStr = memDate.value;

  if (!f) return alert("Choose an image.");
  if (!dateStr) return alert("Select the date the photo was taken.");

  const imageData = await readFileAsDataURL(f);

  // Use DataURL for preview too (no ObjectURL = no revoke issues)
  pendingMemory = { fileName: f.name, tag, dateStr, imageData };

  modalOverlay.style.display = "none";
  toast("Tap anywhere inside the framed wall to place it");
});

// ---- Place on wall: use pointerdown (best on iPad) ----
wall.addEventListener(
  "pointerdown",
  async (ev) => {
    if (!pendingMemory) return;

    ev.preventDefault();
    ev.stopPropagation();

    const vrect = viewport.getBoundingClientRect();
    const tapX = ev.clientX - vrect.left;
    const tapY = ev.clientY - vrect.top;

    const dateTs = toTs(pendingMemory.dateStr) || Date.now();
    const x = computeXFromDate(dateTs);
    const y = Math.max(10, Math.round(tapY - 120));

    // scroll so the chronological X lands under her tap
    scrollToWallX(x, tapX);

    // ensure wall is wide enough BEFORE placing
    ensureWallWidthForX(x);

    // instant local preview (ALWAYS appears)
    const preview = document.createElement("div");
    preview.className = "photo";
    preview.style.left = x + "px";
    preview.style.top = y + "px";
    preview.style.opacity = "0.9";
    preview.style.pointerEvents = "none";
    preview.innerHTML = `
      <div class="dateLabel">${formatDateLabel(pendingMemory.dateStr)}</div>
      <div class="frame">
        <img src="${pendingMemory.imageData}" draggable="false" />
        <div class="tag">${pendingMemory.tag || ""}</div>
      </div>
    `;
    wall.appendChild(preview);

    toast("Uploading…");

    try {
      await postUpload({
        fileName: pendingMemory.fileName,
        tag: pendingMemory.tag,
        imageData: pendingMemory.imageData,
        x,
        y,
        rot: 0,
        scale: 1,
        taken_date: pendingMemory.dateStr,
        sort_ts: dateTs,
      });
      toast("Saved ❤️");
    } catch {
      toast("Saved (refreshing)…");
    }

    // cleanup + refresh real wall from sheet
    pendingMemory = null;

    memTag.value = "";
    memDate.value = "";
    memFile.value = "";

    // refresh list reliably (iframe PM)
    setTimeout(() => {
      listViaIframe();
      // remove preview after real list likely rendered
      setTimeout(() => preview.remove(), 1200);
    }, 900);
  },
  { passive: false }
);

// initial load
listViaIframe();