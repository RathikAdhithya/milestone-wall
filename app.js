const GAS_URL = "https://script.google.com/macros/s/AKfycbwAMAZkN1d4-xBG6bID8kyWCeNKSfKX29STFo_wipVxQFojmBP1jOvnWXKRrx1tvS6D7g/exec";
const UPLOAD_KEY = "kR9!v3QpZx_2Gm7WASJKH972634!98762";

const wall = document.getElementById("wall");
const viewport = document.getElementById("viewport");

const fileInput = document.getElementById("fileInput");
const tagInput = document.getElementById("tagInput");
const uploadBtn = document.getElementById("uploadBtn");

const selectedInfo = document.getElementById("selectedInfo");
const rotSlider = document.getElementById("rotSlider");
const scaleSlider = document.getElementById("scaleSlider");
const editTag = document.getElementById("editTag");
const saveTagBtn = document.getElementById("saveTagBtn");
const deleteBtn = document.getElementById("deleteBtn");

const gasForm = document.getElementById("gasForm");

let items = [];
let selectedId = null;

function jsonpList() {
    const cb = "handleList_" + Date.now();
    window[cb] = (data) => {
        try { renderFromList(data); } finally {
        delete window[cb];
        script.remove();
        }
    };

    const url = `${GAS_URL}?action=list&callback=${cb}&_=${Date.now()}`;
    const script = document.createElement("script");
    script.src = url;
    document.body.appendChild(script);
}

function renderFromList(data) {
    if (!data || !data.ok) return;
    items = data.items || [];
    wall.innerHTML = "";
    selectedId = null;
    setSelected(null);

    for (const it of items) {
        const el = makePhoto(it);
        wall.appendChild(el);
    }
}

function makePhoto(it) {
    const el = document.createElement("div");
    el.className = "photo";
    el.dataset.id = it.id;

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
    const rot = it.rot || 0;
    const scale = it.scale || 1;
    el.style.transform = `rotate(${rot}deg) scale(${scale})`;
}

function setSelected(id) {
    selectedId = id;

    document.querySelectorAll(".photo").forEach(p => p.classList.remove("selected"));

    if (!id) {
        selectedInfo.textContent = "No photo selected";
        rotSlider.value = 0;
        scaleSlider.value = 100;
        editTag.value = "";
        return;
    }

    const el = document.querySelector(`.photo[data-id="${id}"]`);
    if (el) el.classList.add("selected");

    const it = items.find(x => x.id === id);
    selectedInfo.textContent = it ? (it.tag || "(no tag)") : "Selected";
    rotSlider.value = it ? Math.round(it.rot || 0) : 0;
    scaleSlider.value = it ? Math.round((it.scale || 1) * 100) : 100;
    editTag.value = it ? (it.tag || "") : "";
}

document.body.addEventListener("click", () => setSelected(null));

let drag = null;
function startDrag(ev, el) {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);

    const id = el.dataset.id;
    const it = items.find(x => x.id === id);
    if (!it) return;

    setSelected(id);

    drag = {
        id,
        el,
        it,
        startX: ev.clientX,
        startY: ev.clientY,
        origLeft: it.x || 0,
        origTop: it.y || 0
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

function onDragEnd(ev) {
    if (!drag) return;

    drag.el.style.cursor = "grab";
    drag.el.removeEventListener("pointermove", onDragMove);
    drag.el.removeEventListener("pointerup", onDragEnd);
    drag.el.removeEventListener("pointercancel", onDragEnd);

    saveLayout(drag.it);
    drag = null;
}

rotSlider.addEventListener("input", () => {
    if (!selectedId) return;
    const it = items.find(x => x.id === selectedId);
    if (!it) return;
    it.rot = Number(rotSlider.value);
    const el = document.querySelector(`.photo[data-id="${selectedId}"]`);
    if (el) applyTransform(el, it);
});

scaleSlider.addEventListener("input", () => {
    if (!selectedId) return;
    const it = items.find(x => x.id === selectedId);
    if (!it) return;
    it.scale = Number(scaleSlider.value) / 100;
    const el = document.querySelector(`.photo[data-id="${selectedId}"]`);
    if (el) applyTransform(el, it);
});

scaleSlider.addEventListener("change", () => {
    if (!selectedId) return;
    const it = items.find(x => x.id === selectedId);
    if (it) saveLayout(it);
});

rotSlider.addEventListener("change", () => {
    if (!selectedId) return;
    const it = items.find(x => x.id === selectedId);
    if (it) saveLayout(it);
});

saveTagBtn.addEventListener("click", () => {
    if (!selectedId) return;
    const it = items.find(x => x.id === selectedId);
    if (!it) return;
    it.tag = editTag.value.trim().slice(0, 60);

    const el = document.querySelector(`.photo[data-id="${selectedId}"]`);
    if (el) el.querySelector(".tag").textContent = it.tag;

    postViaForm("update", {
        id: it.id,
        tag: it.tag,
        x: it.x, y: it.y, rot: it.rot, scale: it.scale
    });
});

deleteBtn.addEventListener("click", () => {
    if (!selectedId) return;
    postViaForm("delete", { id: selectedId });
});

function saveLayout(it) {
    sendBeaconUpdate(it);
}

function sendBeaconUpdate(it) {
    const params = new URLSearchParams();
    params.set("action", "update");
    params.set("key", UPLOAD_KEY);
    params.set("id", it.id);
    params.set("x", it.x || 0);
    params.set("y", it.y || 0);
    params.set("rot", it.rot || 0);
    params.set("scale", it.scale || 1);

    if (navigator.sendBeacon) {
        const blob = new Blob([params.toString()], { type: "application/x-www-form-urlencoded" });
        navigator.sendBeacon(GAS_URL, blob);
    } else {
        fetch(GAS_URL, { method: "POST", mode: "no-cors", body: params });
    }
}

function postViaForm(action, fields) {
    gasForm.action.value = action;
    gasForm.key.value = UPLOAD_KEY;

    gasForm.id.value = fields.id || "";
    gasForm.fileName.value = fields.fileName || "";
    gasForm.tag.value = fields.tag || "";
    gasForm.imageData.value = fields.imageData || "";
    gasForm.x.value = (fields.x != null) ? fields.x : "";
    gasForm.y.value = (fields.y != null) ? fields.y : "";
    gasForm.rot.value = (fields.rot != null) ? fields.rot : "";
    gasForm.scale.value = (fields.scale != null) ? fields.scale : "";

    gasForm.submit();
    }

    uploadBtn.addEventListener("click", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return alert("Choose an image first.");

    const tag = (tagInput.value || "").trim().slice(0, 60);
    const imageData = await readFileAsDataURL(f);

    const viewLeft = viewport.scrollLeft;
    const x = viewLeft + 240;
    const y = 180;

    postViaForm("upload", {
        fileName: f.name,
        tag,
        imageData,
        x, y,
        rot: 0,
        scale: 1
    });

    fileInput.value = "";
    tagInput.value = "";
});

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || typeof data !== "object") return;

    if (data.ok && data.action === "upload") {
        jsonpList();
    }

    if (data.ok && data.action === "delete") {
        jsonpList();
    }
});

jsonpList();