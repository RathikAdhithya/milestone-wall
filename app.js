// app.js — replacement (NO iframe, NO form posts; uses fetch/sendBeacon)
// Requires: #viewport, #wall, #makeMemoryBtn, #modalOverlay, #memTag, #memDate, #memFile, #memHint, #memCancel, #memPlace

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

let items = [];
let selectedId = null;
let pendingMemory = null;

function formatDateLabel(s) {
  if (!s) return "";
  try {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch (e) {
    return s;
  }
}

function toTs(dateStr) {
  if (!dateStr) return Date.now();
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function postAction(action, fields) {
  const p = new URLSearchParams();
  p.set("action", action);
  p.set("key", UPLOAD_KEY);

  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    p.set(k, String(v));
  }

  if (navigator.sendBeacon) {
    const blob = new Blob([p.toString()], { type: "application/x-www-form-urlencoded" });
    navigator.sendBeacon(GAS_URL, blob);
    return Promise.resolve();
  }

  return fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  }).then(() => {});
}

function jsonpList() {
  const cb = "handleList_" + Date.now();

  const script = document.createElement("script");
  window[cb] = (data) => {
    try {
      renderFromList(data);
    } finally {
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
    sortTs: Number(it.sortTs || it.sort_ts || 0),
  }));

  items.sort((a, b) => (a.sortTs || 0) - (b.sortTs || 0));

  const firstValid = items.find((it) => it.sortTs && it.sortTs > 0);
  const minTs = firstValid ? firstValid.sortTs : Date.now();

  const pxPerDay = 45;
  const paddingX = 200;

  for (const it of items) {
    const t = it.sortTs || minTs;
    const days = Math.round((t - minTs) / (1000 * 60 * 60 * 24));
    it.x = paddingX + days * pxPerDay;
    if (it.y == null) it.y = 180;
  }

  wall.innerHTML = "";
  selectedId = null;
  setSelected(null);

  for (const it of items) {
    wall.appendChild(makePhoto(it));
  }
}

function makePhoto(it) {
  const el = document.createElement("div");
  el.className = "photo";
  el.dataset.id = it.id;

  const d = document.createElement("div");
  d.className = "dateLabel";
  d.textContent = formatDateLabel(it.takenDate);
  el.appendChild(d);

  const frame = document.createElement("div");
  frame.className = "frame";

  const img = document.createElement("img");
  img.src = it.imgUrl;
  img.draggable = false;

  const t = document.createElement("div");
  t.className = "tag";
  t.textContent = it.tag || "";

  frame.appendChild(img);
  frame.appendChild(t);
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
  ev.preventDefault();
  el.setPointerCapture(ev.pointerId);

  const id = el.dataset.id;
  const it = items.find((x) => x.id === id);
  if (!it) return;

  setSelected(id);

  drag = {
    id,
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

  // Persist Y (and any manual X changes) if you want.
  postAction("update", {
    id: drag.it.id,
    x: drag.it.x || 0,
    y: drag.it.y || 0,
    rot: drag.it.rot || 0,
    scale: drag.it.scale || 1,
  });

  drag = null;
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
  memHint.textContent = "Now click anywhere on the wall to place it.";
});

wall.addEventListener("click", async (ev) => {
  if (!pendingMemory) return;
  ev.stopPropagation();

  const rect = wall.getBoundingClientRect();
  const clickY = ev.clientY - rect.top;

  const dateTs = toTs(pendingMemory.dateStr);

  const firstValid = items.find((it) => it.sortTs && it.sortTs > 0);
  const minTs = firstValid ? firstValid.sortTs : dateTs;

  const pxPerDay = 45;
  const paddingX = 200;
  const days = Math.round((dateTs - minTs) / (1000 * 60 * 60 * 24));
  const x = paddingX + days * pxPerDay;

  const y = Math.max(10, Math.round(clickY - 120));

  await postAction("upload", {
    fileName: pendingMemory.fileName,
    tag: pendingMemory.tag,
    imageData: pendingMemory.imageData,
    x,
    y,
    rot: 0,
    scale: 1,
    taken_date: pendingMemory.dateStr,
  });

  modalOverlay.style.display = "none";
  pendingMemory = null;

  memTag.value = "";
  memDate.value = "";
  memFile.value = "";
  memHint.textContent = "Pick a photo + date, then click “Place on wall”.";

  // refresh list after upload
  setTimeout(jsonpList, 800);
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

jsonpList();