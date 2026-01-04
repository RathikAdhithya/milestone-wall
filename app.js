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
let selectedId = null;

function toast(msg, ms = 1600) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastEl.__t);
  toastEl.__t = window.setTimeout(() => toastEl.classList.remove("show"), ms);
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

function jsonpList() {
  const cb = "handleList_" + Date.now();
  const script = document.createElement("script");

  window[cb] = (data) => {
    try { renderFromList(data); }
    finally {
      delete window[cb];
      script.remove();
    }
  };

  script.src = `${GAS_URL}?action=list&callback=${cb}&_=${Date.now()}`;
  document.body.appendChild(script);
}

function renderFromList(data) {
  if (!data || !data.ok) return;

  items = (data.items || []).map((it) => ({
    ...it,
    takenDate: it.takenDate || it.taken_date || "",
    sortTs: Number(it.sortTs || it.sort_ts || (it.takenDate ? toTs(it.takenDate) : 0)),
    x: Number(it.x || 0),
    y: Number(it.y || 0),
    rot: Number(it.rot || 0),
    scale: Number(it.scale || 1)
  }));

  items.sort((a, b) => (a.sortTs || 0) - (b.sortTs || 0));

  // Make chronological layout (x from date) BUT keep existing y
  const firstValid = items.find((it) => it.sortTs && it.sortTs > 0);
  const minTs = firstValid ? firstValid.sortTs : Date.now();

  const pxPerDay = 45;
  const paddingX = 200;

  for (const it of items) {
    const t = it.sortTs || minTs;
    const days = Math.round((t - minTs) / (1000 * 60 * 60 * 24));
    it.x = paddingX + days * pxPerDay;
    if (!Number.isFinite(it.y) || it.y <= 0) it.y = 180;
  }

  wall.innerHTML = "";
  selectedId = null;

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

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = it.tag || "";

  frame.appendChild(img);
  frame.appendChild(tag);
  el.appendChild(frame);

  applyTransform(el, it);

  el.addEventListener("pointerdown", (ev) => startDrag(ev, el));
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setSelected(it.id);
  });

  return el;
}

function applyTransform(el, it) {
  el.style.left = (it.x || 0) + "px";
  el.style.top = (it.y || 0) + "px";
  el.style.transform = `rotate(${it.rot || 0}deg) scale(${it.scale || 1})`;
}

function setSelected(id) {
  selectedId = id;
  document.querySelectorAll(".photo").forEach((p) => p.classList.remove("selected"));
  if (!id) return;
  const el = document.querySelector(`.photo[data-id="${id}"]`);
  if (el) el.classList.add("selected");
}

document.body.addEventListener("click", () => setSelected(null));

let drag = null;

function startDrag(ev, el) {
  // If we’re in “place mode”, don’t start dragging
  if (pendingMemory) return;

  ev.preventDefault();
  el.setPointerCapture(ev.pointerId);

  const id = el.dataset.id;
  const it = items.find((x) => x.id === id);
  if (!it) return;

  setSelected(id);

  drag = {
    el,
    it,
    startX: ev.clientX,
    startY: ev.clientY,
    origLeft: it.x || 0,
    origTop: it.y || 0,
  };

  el.style.cursor = "grabbing";
  el.addEventListener("pointermove", onDragMove);
  el.addEventListener("pointerup", onDragEnd);
  el.addEventListener("pointercancel", onDragEnd);
}

function onDragMove(ev) {
  if (!drag) return;
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;

  const nx = Math.round(drag.origLeft + dx);
  const ny = Math.round(drag.origTop + dy);

  drag.it.x = nx;
  drag.it.y = ny;

  drag.el.style.left = nx + "px";
  drag.el.style.top = ny + "px";
}

function onDragEnd() {
  if (!drag) return;

  drag.el.style.cursor = "grab";
  drag.el.removeEventListener("pointermove", onDragMove);
  drag.el.removeEventListener("pointerup", onDragEnd);
  drag.el.removeEventListener("pointercancel", onDragEnd);

  // Small updates can use beacon
  postUpdate({
    id: drag.it.id,
    x: drag.it.x || 0,
    y: drag.it.y || 0,
    rot: drag.it.rot || 0,
    scale: drag.it.scale || 1,
  });

  drag = null;
}

function postUpdate(fields) {
  const p = new URLSearchParams();
  p.set("action", "update");
  p.set("key", UPLOAD_KEY);
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    p.set(k, String(v));
  }
  if (navigator.sendBeacon) {
    const blob = new Blob([p.toString()], { type: "application/x-www-form-urlencoded" });
    navigator.sendBeacon(GAS_URL, blob);
  } else {
    fetch(GAS_URL, { method: "POST", mode: "no-cors", body: p });
  }
}

// IMPORTANT: uploads must NOT use sendBeacon (can silently fail for big payloads)
async function postUpload(fields) {
  const p = new URLSearchParams();
  p.set("action", "upload");
  p.set("key", UPLOAD_KEY);

  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    p.set(k, String(v));
  }

  // no-cors => request is sent; response is opaque (fine)
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: p });
}

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

  pendingMemory = { fileName: f.name, tag, dateStr, imageData };

  // CLOSE MODAL so she can tap the wall (this was your placement bug)
  modalOverlay.style.display = "none";
  toast("Tap anywhere inside the framed wall to place it");

  // Optional: reset hint text inside modal for next time
  memHint.textContent = "Pick a photo + date, then click “Place on wall”.";
});

// Use pointerdown on iPad (more reliable than click after scrolling)
wall.addEventListener("pointerdown", async (ev) => {
  if (!pendingMemory) return;

  ev.preventDefault();
  ev.stopPropagation();

  const rect = wall.getBoundingClientRect();
  const clickY = ev.clientY - rect.top;

  const dateTs = toTs(pendingMemory.dateStr) || Date.now();

  const firstValid = items.find((it) => it.sortTs && it.sortTs > 0);
  const minTs = firstValid ? firstValid.sortTs : dateTs;

  const pxPerDay = 45;
  const paddingX = 200;
  const days = Math.round((dateTs - minTs) / (1000 * 60 * 60 * 24));
  const x = paddingX + days * pxPerDay;

  const y = Math.max(10, Math.round(clickY - 120));

  toast("Uploading…");

  try {
    await postUpload({
      fileName: pendingMemory.fileName,
      tag: pendingMemory.tag,
      imageData: pendingMemory.imageData,
      x, y,
      rot: 0,
      scale: 1,
      taken_date: pendingMemory.dateStr,
      sort_ts: dateTs
    });

    toast("Saved ❤️");
  } catch (e) {
    // Even if fetch throws, it may still have sent the request; we still refresh
    toast("Trying again…");
  }

  pendingMemory = null;

  memTag.value = "";
  memDate.value = "";
  memFile.value = "";

  // Refresh list (give Drive a moment)
  setTimeout(jsonpList, 1200);
}, { passive: false });

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

jsonpList();