import * as h5wasm from "../vendor/h5wasm/hdf5_hl.js";
import { readGeometry, readDatasets, finalTimestep, isGeometryFile, isDatasetsFile } from "./h5.js";
import { toLonLat, lonLatToMerc } from "./geo.js";
import { makeColorFn, legendBands, paramDef } from "./ramps.js";
import { fillMesh } from "./contour.js";
import { makeView, FRAMES, ftPerPixel } from "./view.js";
import { drawTitle, drawLegend, drawNorthArrow, drawScaleBar } from "./render.js";
import { drawBasemap, ESRI_WORLD_IMAGERY } from "./tiles.js";
import shp from "shpjs";
import { drawOverlays, drawOverlayLabels, describe, propKeys, OVERLAY_PALETTE } from "./overlays.js";

const $ = (id) => document.getElementById(id);
let geom = null, datasets = null, dFile = null, ready = false;
let scene = null;        // cached generated figure (so rotation/orientation are instant)
let overlays = [];       // [{ name, geojson, color, width, hidden }]
let rotDeg = 0, zoom = 1, panX = 0, panY = 0;
const PAN_STEP = 30;     // screen px per pan click (frame coords) — small for fine control
const ZOOM_STEP = 1.08;  // zoom factor per click — small for fine control

(async () => { await h5wasm.ready; ready = true; })();

const setStatus = (html) => ($("fileStatus").innerHTML = html);
const msg = (text, type = "ok") => ($("messages").innerHTML = `<div class="msg-${type}">${text}</div>`);
const runLabel = (n) => n.replace(/\(SRH-2D\)/i, "").replace(/^EX\b/i, "Existing").replace(/^PR\b/i, "Proposed").trim();

$("files").addEventListener("change", async (e) => {
  if (!ready) await h5wasm.ready;
  for (const file of e.target.files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const fname = file.name.replace(/[^\w.]/g, "_");
    h5wasm.FS.writeFile(fname, buf);
    const h = new h5wasm.File(fname, "r");
    if (isGeometryFile(h)) { geom = readGeometry(h); }
    else if (isDatasetsFile(h)) { dFile = h; datasets = readDatasets(h); }
  }
  refreshStatus();
});

function refreshStatus() {
  const g = geom ? `✓ geometry (${geom.N} nodes${geom.wkt ? ", CRS ✓" : ", no CRS"})` : "— geometry .h5 missing";
  const d = datasets ? `✓ datasets (${datasets.runs.length} runs)` : "— datasets .h5 missing";
  setStatus(`<div>${g}</div><div>${d}</div>`);
  if (datasets) {
    $("run").innerHTML = datasets.runs.map((r, i) => `<option value="${i}">${runLabel(r.name)}</option>`).join("");
    populateParams();
  }
  // progressive disclosure: run/parameter + Generate appear once both files are in
  const both = !!(geom && datasets);
  $("dataSelectors").hidden = !both;
  $("actions").hidden = !both;
}

function populateParams() {
  const run = datasets.runs[+$("run").value];
  const scalars = Object.keys(run.params).filter((p) => !run.params[p].vector);
  $("param").innerHTML = scalars.map((p) => `<option value="${p}">${paramDef(p).label}</option>`).join("");
}
$("run").addEventListener("change", populateParams);

// ---- overlay shapefiles (.zip) ----
$("overlayFiles").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    try {
      const res = await shp(await file.arrayBuffer());     // → GeoJSON (lon/lat)
      for (const fc of (Array.isArray(res) ? res : [res])) {
        overlays.push({
          name: (fc.fileName || file.name).replace(/\.zip$/i, "").split("/").pop(),
          geojson: fc, color: OVERLAY_PALETTE[overlays.length % OVERLAY_PALETTE.length],
          width: 3, hidden: false, labelField: "", labelSize: 22, fields: propKeys(fc),
        });
      }
    } catch (err) { msg(`Could not read ${file.name}: ${err.message}`, "err"); }
  }
  e.target.value = "";
  renderOverlayList();
  if (scene) render();
});

function renderOverlayList() {
  const ul = $("overlayList");
  ul.innerHTML = "";
  overlays.forEach((ov, i) => {
    const li = document.createElement("li");
    li.className = "ov-item";
    const opts = ['<option value="">No labels</option>']
      .concat(ov.fields.map((f) => `<option value="${escapeAttr(f)}"${f === ov.labelField ? " selected" : ""}>${escapeHtml(f)}</option>`))
      .join("");
    li.innerHTML = `
      <div class="ov-row">
        <input type="checkbox" class="ov-show"${ov.hidden ? "" : " checked"} title="Show / hide" />
        <input type="color" class="ov-color" value="${ov.color}" title="Color" />
        <span class="ov-name" title="${escapeAttr(ov.name)}">${escapeHtml(ov.name)} <em>(${describe(ov.geojson)})</em></span>
        <button class="mini ov-del" title="Remove">✕</button>
      </div>
      <div class="ov-row ov-row2">
        <label class="inline">Size <input type="number" class="ov-w" value="${ov.width}" min="1" max="12" step="1" /></label>
        <label class="inline grow">Label <select class="ov-label">${opts}</select></label>
        <label class="inline">Text <input type="number" class="ov-ls" value="${ov.labelSize}" min="8" max="60" step="1" /></label>
      </div>`;
    li.querySelector(".ov-show").addEventListener("change", (e) => { ov.hidden = !e.target.checked; scene && render(); });
    li.querySelector(".ov-color").addEventListener("input", (e) => { ov.color = e.target.value; scene && render(); });
    li.querySelector(".ov-w").addEventListener("input", (e) => { ov.width = parseFloat(e.target.value) || 3; scene && render(); });
    li.querySelector(".ov-label").addEventListener("change", (e) => { ov.labelField = e.target.value; scene && render(); });
    li.querySelector(".ov-ls").addEventListener("input", (e) => { ov.labelSize = parseFloat(e.target.value) || 22; scene && render(); });
    li.querySelector(".ov-del").addEventListener("click", () => { overlays.splice(i, 1); renderOverlayList(); scene && render(); });
    ul.appendChild(li);
  });
}
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

// ---- generate: read data + build the cached scene, then render ----
$("generate").addEventListener("click", async () => {
  $("generate").disabled = true;
  try { await generate(); } catch (err) { msg(err.message, "err"); console.error(err); }
  finally { $("generate").disabled = false; }
});

async function generate() {
  const run = datasets.runs[+$("run").value];
  const paramName = $("param").value;
  const def = paramDef(paramName);
  const values = finalTimestep(dFile, run.name, paramName);

  const { lon, lat } = toLonLat(geom.xy, geom.wkt);
  const { mx, my } = lonLatToMerc(lon, lat);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < mx.length; i++) { if (mx[i] < x0) x0 = mx[i]; if (mx[i] > x1) x1 = mx[i]; if (my[i] < y0) y0 = my[i]; if (my[i] > y1) y1 = my[i]; }
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (v > -900) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // auto-scale to the data as it comes from SMS (nice rounded bounds for a clean legend)
  const nb = niceBounds(lo, hi);
  const range = { min: nb.min, max: nb.max };
  $("legendIntervals").value = Math.max(2, Math.round((nb.max - nb.min) / nb.step));
  $("legendRamp").value = def.ramp; // SMS-default ramp for this parameter (user can change)

  scene = {
    mx, my, tris: geom.tris, values, def, paramName, range,
    bbox: { x0, x1, y0, y1 }, latRad: (lat.reduce((a, b) => a + b, 0) / lat.length) * Math.PI / 180,
    title: `${runLabel(run.name)} — ${def.label}${def.units ? " (" + def.units + ")" : ""}`,
    fileBase: `${runLabel(run.name).replace(/\W+/g, "_")}_${def.key}`,
    wetMax: hi,
  };
  await render();
  // reveal the figure and the rest of the controls (collapsed) on first generate
  $("placeholder").hidden = true;
  $("figure").hidden = false;
  $("download").hidden = false;
  $("customize").hidden = false;
  msg(`Generated ${scene.title}. Wet max ${scene.wetMax.toFixed(2)} ${scene.def.units}.`, "ok");
}

// ---- render: uses the cached scene + current orientation/rotation (instant) ----
async function render() {
  if (!scene) return;
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const cv = $("figure"); cv.width = frame.w; cv.height = frame.h;
  const ctx = cv.getContext("2d");
  const view = makeView(scene.bbox, { w: frame.w, h: frame.h, rotDeg, zoom, panX, panY });

  // neutral backdrop (only visible if a tile fails); full-bleed otherwise
  ctx.fillStyle = "#e7ebf0"; ctx.fillRect(0, 0, frame.w, frame.h);

  // Esri World Imagery aerial (best-effort; figure still renders if offline)
  await drawBasemap(ctx, view, { url: ESRI_WORLD_IMAGERY });
  // fade the aerial so contours read on top
  ctx.fillStyle = "rgba(255,255,255,0.42)"; ctx.fillRect(0, 0, frame.w, frame.h);

  // legend/contour classification: user-set number of intervals drives both
  const count = Math.min(60, Math.max(2, parseInt($("legendIntervals").value, 10) || 12));
  const o = { min: scene.range.min, max: scene.range.max, interval: (scene.range.max - scene.range.min) / count, ramp: $("legendRamp").value };

  // contours, rotated with the map (shares the panned origin)
  ctx.save();
  ctx.translate(view.originX, view.originY); ctx.rotate(view.rotRad);
  const N = scene.mx.length, lx = new Float64Array(N), ly = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = view.toLocal(scene.mx[i], scene.my[i]); lx[i] = p[0]; ly[i] = p[1]; }
  fillMesh(ctx, lx, ly, scene.tris, scene.values, makeColorFn(scene.paramName, o));
  drawOverlays(ctx, overlays, view); // shapefile overlays ride the same transform
  ctx.restore();

  // overlay labels: upright in screen space (so they stay readable when rotated)
  drawOverlayLabels(ctx, overlays, view);

  // upright overlays — each placeable + sizable, and individually show/hide-able
  const num = (id, d) => parseFloat($(id).value) || d;
  const on = (id) => $(id).checked;
  const F = { frameW: frame.w, frameH: frame.h };
  if (on("showTitle")) drawTitle(ctx, scene.title, {
    ...F, anchor: $("titlePos").value, offX: num("titleX", 0), offY: num("titleY", 0), fontSize: num("titleFont", 24),
  });
  if (on("showLegend")) drawLegend(ctx, legendBands(scene.paramName, o), {
    ...F, anchor: $("legendPos").value, offX: num("legendX", 0), offY: num("legendY", 0), fontSize: num("legendFont", 20),
  });
  if (on("showNorth")) drawNorthArrow(ctx, {
    ...F, anchor: $("naPos").value, offX: num("naX", 0), offY: num("naY", 0), radius: num("naSize", 46), rotRad: view.rotRad,
  });
  if (on("showScale")) drawScaleBar(ctx, {
    ...F, anchor: $("sbPos").value, offX: num("sbX", 0), offY: num("sbY", 0),
    ftPerPixel: ftPerPixel(view, scene.latRad), sizeScale: num("sbSize", 1.4), segments: num("sbSegments", 4),
  });

  $("download").disabled = false;
  $("download").onclick = () => {
    const a = document.createElement("a");
    a.download = `${scene.fileBase}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  };
}

// ---- view + legend controls (live re-render from the cached scene) ----
$("orientation").addEventListener("change", () => scene && render());
for (const id of [
  "legendPos", "legendX", "legendY", "legendFont", "legendIntervals", "legendRamp",
  "titlePos", "titleX", "titleY", "titleFont",
  "naPos", "naX", "naY", "naSize",
  "sbPos", "sbX", "sbY", "sbSize", "sbSegments",
]) $(id).addEventListener("input", () => scene && render());
function setRot(deg) { rotDeg = ((deg % 360) + 360) % 360; $("rot").value = rotDeg; scene && render(); }
$("rotCCW").addEventListener("click", () => setRot(rotDeg - 90));
$("rotCW").addEventListener("click", () => setRot(rotDeg + 90));
$("rot").addEventListener("change", () => setRot(parseFloat($("rot").value) || 0));

// ---- zoom + pan (panel-only) ----
const rerender = () => scene && render();
$("zoomIn").addEventListener("click", () => { zoom *= ZOOM_STEP; rerender(); });
$("zoomOut").addEventListener("click", () => { zoom /= ZOOM_STEP; rerender(); });
$("panL").addEventListener("click", () => { panX -= PAN_STEP; rerender(); });
$("panR").addEventListener("click", () => { panX += PAN_STEP; rerender(); });
$("panU").addEventListener("click", () => { panY -= PAN_STEP; rerender(); });
$("panD").addEventListener("click", () => { panY += PAN_STEP; rerender(); });
$("viewReset").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; rotDeg = 0; $("rot").value = 0; rerender(); });

// ---- info tooltips: click to pin open, click-away / Esc to close ----
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".info-i");
  if (btn) {
    e.preventDefault(); e.stopPropagation();          // don't toggle a parent <summary>
    const tip = btn.parentElement, isOpen = tip.classList.contains("open");
    document.querySelectorAll(".infotip.open").forEach((t) => t.classList.remove("open"));
    if (!isOpen) tip.classList.add("open");
  } else if (!e.target.closest(".info-pop")) {
    document.querySelectorAll(".infotip.open").forEach((t) => t.classList.remove("open"));
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".infotip.open").forEach((t) => t.classList.remove("open"));
});

// ---- per-element show/hide toggles (in each group header) ----
document.querySelectorAll(".show-toggle").forEach((cb) => {
  cb.addEventListener("click", (e) => e.stopPropagation());      // don't toggle the <details>
  cb.addEventListener("change", () => scene && render());
});

function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 5, 10].map((m) => m * pow).find((n) => n >= v) || 10 * pow;
}
function niceStep(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}
// Data-driven legend bounds: floor/ceil the data range to a nice step (uses the
// real data min, so e.g. Water Surface starts ~55 ft, not 0).
function niceBounds(lo, hi) {
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi) || hi <= lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 10) || 1;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}
