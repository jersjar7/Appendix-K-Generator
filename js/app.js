import * as h5wasm from "../vendor/h5wasm/hdf5_hl.js";
import { readGeometry, readDatasets, finalTimestep, isGeometryFile, isDatasetsFile } from "./h5.js";
import { toLonLat, lonLatToMerc } from "./geo.js";
import { makeColorFn, legendBands, paramDef, RAMPS, RAMP_OPTIONS } from "./ramps.js";
import { fillMesh } from "./contour.js";
import { makeView, FRAMES, ftPerPixel } from "./view.js";
import { drawTitle, drawLegend, drawNorthArrow, drawScaleBar, drawAnnotations } from "./render.js";
import { drawBasemap, ESRI_WORLD_IMAGERY } from "./tiles.js";
import shp from "shpjs";
import { drawOverlays, drawOverlayLabels, describe, propKeys, OVERLAY_PALETTE } from "./overlays.js";
import { buildReportDocx } from "./reportdoc.js";

const $ = (id) => document.getElementById(id);
let ready = false;
// per-condition meshes, keyed EX/PR/… : { geom, dFile, datasets, proj }
// proj = reprojected mesh { N, tris, mx, my, z, bbox, latRad } (done once at load)
const conditions = new Map();
const getCond = (k) => { if (!conditions.has(k)) conditions.set(k, {}); return conditions.get(k); };
// Decide a mesh's condition from its internal name AND the uploaded file name,
// matching either the EX/PR abbreviation or the spelled-out word.
const condKey = (name, fileName = "") => {
  const s = `${name} ${fileName}`;
  if (/\bPR\b|PR[_-]?Mesh|propos/i.test(s)) return "PR";
  if (/\bEX\b|EX[_-]?Mesh|exist/i.test(s)) return "EX";
  return "DEFAULT";
};
const condLabel = (k) => ({ EX: "Existing", PR: "Proposed" }[k] || "Mesh");
function allRuns() {                       // flat run list across complete conditions
  const out = [];
  for (const [key, c] of conditions) if (c.proj && c.datasets) for (const run of c.datasets.runs) out.push({ key, run, cond: c });
  return out;
}
function commonBbox() {                     // union of all meshes' merc extents → shared map extent
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [, c] of conditions) if (c.proj) { const b = c.proj.bbox; x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1); }
  return { x0, x1, y0, y1 };
}
function projectMesh(geom) {
  const { lon, lat } = toLonLat(geom.xy, geom.wkt);
  const { mx, my } = lonLatToMerc(lon, lat);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < mx.length; i++) { if (mx[i] < x0) x0 = mx[i]; if (mx[i] > x1) x1 = mx[i]; if (my[i] < y0) y0 = my[i]; if (my[i] > y1) y1 = my[i]; }
  const latRad = (lat.reduce((a, b) => a + b, 0) / lat.length) * Math.PI / 180;
  return { N: geom.N, tris: geom.tris, mx, my, z: geom.z, bbox: { x0, x1, y0, y1 }, latRad };
}
let scene = null;        // cached generated figure (so rotation/orientation are instant)
let overlays = [];       // [{ name, geojson, color, width, hidden }]
let annotations = [];    // user text labels + arrows (see drawAnnotations in render.js)
let annoSeq = 0;
let rotDeg = 0, zoom = 1, panX = 0, panY = 0;
const PAN_STEP = 30;     // screen px per pan click (frame coords) — small for fine control
const ZOOM_STEP = 1.08;  // zoom factor per click — small for fine control
const ANNO_NUDGE = 10;   // px per annotation nudge click

(async () => { await h5wasm.ready; ready = true; })();

const setStatus = (html) => ($("fileStatus").innerHTML = html);
const msg = (text, type = "ok") => ($("messages").innerHTML = `<div class="msg-${type}">${text}</div>`);
const runLabel = (n) => n.replace(/\(SRH-2D\)/i, "").replace(/^EX\b/i, "Existing").replace(/^PR\b/i, "Proposed").trim();

async function ingestMeshFiles(files) {
  if (!ready) await h5wasm.ready;
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const fname = file.name.replace(/[^\w.]/g, "_");
    h5wasm.FS.writeFile(fname, buf);
    const h = new h5wasm.File(fname, "r");
    if (isGeometryFile(h)) { const g = readGeometry(h); getCond(condKey(g.meshName, fname)).proj = projectMesh(g); }
    else if (isDatasetsFile(h)) { const ds = readDatasets(h); const c = getCond(condKey(ds.runs[0] ? ds.runs[0].name : "", fname)); c.dFile = h; c.datasets = ds; }
  }
  refreshStatus();
}

// click-or-drop dropzone: a styled label triggers the hidden input; dragged
// files (matching `accept`) are routed through the same handler.
function wireDropzone(zoneId, inputId, onFiles, accept) {
  const zone = $(zoneId), input = $(inputId);
  input.addEventListener("change", (e) => { onFiles([...e.target.files]); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
  ["dragleave", "dragend", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
  zone.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => accept.test(f.name));
    if (files.length) onFiles(files);
  });
}
wireDropzone("dropMesh", "files", ingestMeshFiles, /\.h5$/i);

function refreshStatus() {
  const badge = (on, label, detail) =>
    `<span class="badge ${on ? "on" : ""}">${on ? "✓ " : ""}${label}${on && detail ? ` <em>${detail}</em>` : ""}</span>`;
  const rows = [];
  for (const [k, c] of conditions) {
    rows.push(`<div class="cond-row"><span class="cond-name">${condLabel(k)}</span>` +
      badge(!!c.proj, "geometry", c.proj && `${c.proj.N} nodes`) +
      badge(!!c.datasets, "datasets", c.datasets && `${c.datasets.runs.length} runs`) + `</div>`);
  }
  setStatus(rows.length ? rows.join("") : `<div class="status-empty">No files yet — add the geometry + datasets <code>.h5</code> for each mesh.</div>`);

  const runs = allRuns();
  $("run").innerHTML = runs.map((r, i) => `<option value="${i}">${runLabel(r.run.name)}</option>`).join("");
  if (runs.length) populateParams();
  $("dataSelectors").hidden = !runs.length;
  $("actions").hidden = !runs.length;
}

function populateParams() {
  const sel = allRuns()[+$("run").value];
  if (!sel) return;
  const scalars = Object.keys(sel.run.params).filter((p) => !sel.run.params[p].vector);
  $("param").innerHTML = scalars.map((p) => `<option value="${p}">${paramDef(p).label}</option>`).join("");
}
$("run").addEventListener("change", populateParams);

// ---- overlay shapefiles (.zip) ----
async function ingestOverlayFiles(files) {
  for (const file of files) {
    try {
      const res = await shp(await file.arrayBuffer());     // → GeoJSON (lon/lat)
      for (const fc of (Array.isArray(res) ? res : [res])) {
        overlays.push({
          name: (fc.fileName || file.name).replace(/\.zip$/i, "").split("/").pop(),
          geojson: fc, color: OVERLAY_PALETTE[overlays.length % OVERLAY_PALETTE.length],
          width: 3, hidden: false, labelField: "", labelSize: 22, fields: propKeys(fc), open: false,
        });
      }
    } catch (err) { msg(`Could not read ${file.name}: ${err.message}`, "err"); }
  }
  renderOverlayList();
  if (scene) render();
}
wireDropzone("dropOverlay", "overlayFiles", ingestOverlayFiles, /\.zip$/i);

function renderOverlayList() {
  const ul = $("overlayList");
  ul.innerHTML = "";
  overlays.forEach((ov, i) => {
    const li = document.createElement("li");
    li.className = "ov-item";
    const desc = describe(ov.geojson), sp = desc.indexOf(" ");   // "14320 points" → count + kind
    const count = sp > 0 ? desc.slice(0, sp) : "", kind = sp > 0 ? desc.slice(sp + 1) : desc;
    const opts = ['<option value="">No labels</option>']
      .concat(ov.fields.map((f) => `<option value="${escapeAttr(f)}"${f === ov.labelField ? " selected" : ""}>${escapeHtml(f)}</option>`))
      .join("");
    li.innerHTML = `
      <div class="ov-head">
        <input type="checkbox" class="ov-show"${ov.hidden ? "" : " checked"} title="Show / hide" />
        <input type="color" class="ov-color" value="${ov.color}" title="Color" />
        <span class="ov-name" title="${escapeAttr(ov.name)}">${escapeHtml(ov.name)}</span>
        <span class="ov-type">${escapeHtml(kind)}</span>
        <span class="ov-count">${count}</span>
        <button type="button" class="ov-expand" title="Style this overlay" aria-expanded="${ov.open ? "true" : "false"}">${ov.open ? "▴" : "▾"}</button>
        <button type="button" class="ov-del" title="Remove">✕</button>
      </div>
      <div class="ov-body"${ov.open ? "" : " hidden"}>
        <label class="inline">Width <input type="number" class="ov-w" value="${ov.width}" min="1" max="12" step="1" /></label>
        <label>Label <select class="ov-label">${opts}</select></label>
        <label class="inline ov-lsize"${ov.labelField ? "" : " hidden"}>Label size <input type="number" class="ov-ls" value="${ov.labelSize}" min="8" max="60" step="1" /></label>
      </div>`;
    const body = li.querySelector(".ov-body"), lsize = li.querySelector(".ov-lsize");
    li.querySelector(".ov-expand").addEventListener("click", (e) => {
      ov.open = !ov.open; body.hidden = !ov.open;
      e.currentTarget.textContent = ov.open ? "▴" : "▾";
      e.currentTarget.setAttribute("aria-expanded", ov.open ? "true" : "false");
    });
    li.querySelector(".ov-show").addEventListener("change", (e) => { ov.hidden = !e.target.checked; scene && render(); });
    li.querySelector(".ov-color").addEventListener("input", (e) => { ov.color = e.target.value; scene && render(); });
    li.querySelector(".ov-w").addEventListener("input", (e) => { ov.width = parseFloat(e.target.value) || 3; scene && render(); });
    li.querySelector(".ov-label").addEventListener("change", (e) => { ov.labelField = e.target.value; lsize.hidden = !ov.labelField; scene && render(); });
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

const eventOf = (name) => name.replace(/\(SRH-2D\)/i, "").replace(/^(EX|PR)\b/i, "").trim();

// Build the data for one figure (run + parameter) — used by the live view AND
// the batch report. Auto-scales the legend to that figure's data.
function buildFig(runSel, paramName) {
  const { run, cond, key } = runSel;
  const def = paramDef(paramName);
  const values = finalTimestep(cond.dFile, run.name, paramName);
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (v > -900) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const nb = niceBounds(lo, hi);
  return {
    proj: cond.proj, values, def, paramName, range: { min: nb.min, max: nb.max },
    condKey: key, event: eventOf(run.name), condName: condLabel(key), runText: runLabel(run.name),
    title: `${runLabel(run.name)} — ${def.label}${def.units ? " (" + def.units + ")" : ""}`,
    fileBase: `${runLabel(run.name).replace(/\W+/g, "_")}_${def.key}`,
    defRamp: def.ramp, defCount: Math.max(2, Math.round((nb.max - nb.min) / nb.step)), defStep: nb.step, wetMax: hi,
  };
}

// Title is a TEMPLATE with tokens each figure fills in, so every figure's title
// is correct and specific (in the live view AND the Word report) while sharing
// one format. Empty template → the default below.
const DEFAULT_TITLE_TEMPLATE = "{run} — {parameter} ({units})";
function resolveTitle(fig, template) {
  const tpl = (template && template.trim()) || DEFAULT_TITLE_TEMPLATE;
  const map = {
    run: fig.runText || "", condition: fig.condName || "", event: fig.event || "",
    parameter: fig.def?.label || "", units: fig.def?.units || "",
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
    .replace(/\(\s*\)/g, "")                  // drop empty () when a token (e.g. units) was blank
    .replace(/\s{2,}/g, " ").replace(/\s*—\s*$/, "").replace(/^\s*—\s*/, "").trim();
}
const figTitle = (fig) => resolveTitle(fig, $("titleText").value);  // reads the live template
function updateTitlePreview() {
  $("titlePreview").textContent = scene ? figTitle(scene) : "—";
}

// ---- legend scale, stored PER PARAMETER ----
// Each parameter (shear/velocity/depth/wse/froude) keeps its own min/max/interval
// /ramp, so the live figure AND every report figure use the right scale. Auto
// (data-driven) until the user edits a legend control for that parameter.
const legendByParam = new Map();
const legendDefaults = (fig) => ({ min: fig.range.min, max: fig.range.max, step: fig.defStep, ramp: fig.defRamp });
function legendFor(fig) {
  const d = legendDefaults(fig);
  const s = legendByParam.get(fig.def.key);
  if (!s) return d;
  const min = isFinite(s.min) ? s.min : d.min;
  let max = isFinite(s.max) ? s.max : d.max;
  if (max <= min) max = min + (d.step || 1);
  let step = isFinite(s.step) && s.step > 0 ? s.step : d.step;
  if ((max - min) / step > 200) step = (max - min) / 200;   // guard against runaway band counts
  return { min, max, step, ramp: s.ramp || d.ramp };
}
const trimNum = (v) => Number(v.toFixed(4)).toString();
function loadLegendControls(fig) {                 // populate the legend inputs for this parameter
  const ls = legendFor(fig);
  $("legendMin").value = trimNum(ls.min);
  $("legendMax").value = trimNum(ls.max);
  $("legendStep").value = trimNum(ls.step);
  $("legendRamp").value = ls.ramp;
  updateRampPreview();
}
function storeLegend() {                           // pin the current controls to the current parameter
  if (!scene) return;
  legendByParam.set(scene.def.key, {
    min: parseFloat($("legendMin").value), max: parseFloat($("legendMax").value),
    step: parseFloat($("legendStep").value), ramp: $("legendRamp").value,
  });
}

async function generate() {
  const sel = allRuns()[+$("run").value];
  if (!sel) return;
  scene = buildFig(sel, $("param").value);
  loadLegendControls(scene);                     // load this parameter's stored/auto scale
  await render();
  $("placeholder").hidden = true;
  $("figure").hidden = false;
  $("download").hidden = false;
  $("customize").hidden = false;
  if (typeof refreshReport === "function") refreshReport();
  msg(`Generated ${scene.title}. Wet max ${scene.wetMax.toFixed(2)} ${scene.def.units}.`, "ok");
}

// ---- render the live figure (reads the legend ramp/intervals the user edits) ----
async function render() {
  if (!scene) return;
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const cv = $("figure"); cv.width = frame.w; cv.height = frame.h;
  await composeFigure(cv.getContext("2d"), frame, scene);
  updateTitlePreview();
  $("download").disabled = false;
  $("download").onclick = () => {
    const a = document.createElement("a");
    a.download = `${scene.fileBase}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  };
}

// ---- compose one figure onto any 2D context (live or off-screen for the report) ----
// Uses the SHARED view (commonBbox + current rotation/zoom/pan/frame) and the
// current element layout/show-toggles, so every figure is framed identically.
async function composeFigure(ctx, frame, fig) {
  const view = makeView(commonBbox(), { w: frame.w, h: frame.h, rotDeg, zoom, panX, panY });
  ctx.fillStyle = "#e7ebf0"; ctx.fillRect(0, 0, frame.w, frame.h);
  await drawBasemap(ctx, view, { url: ESRI_WORLD_IMAGERY });        // tiles cached across figures
  ctx.fillStyle = "rgba(255,255,255,0.42)"; ctx.fillRect(0, 0, frame.w, frame.h);

  const ls = legendFor(fig);                       // per-parameter scale (min/max/interval/ramp)
  const o = { min: ls.min, max: ls.max, interval: ls.step, ramp: ls.ramp };

  ctx.save();
  ctx.translate(view.originX, view.originY); ctx.rotate(view.rotRad);
  const N = fig.proj.mx.length, lx = new Float64Array(N), ly = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = view.toLocal(fig.proj.mx[i], fig.proj.my[i]); lx[i] = p[0]; ly[i] = p[1]; }
  fillMesh(ctx, lx, ly, fig.proj.tris, fig.values, makeColorFn(fig.paramName, o));
  drawOverlays(ctx, overlays, view);
  ctx.restore();
  drawOverlayLabels(ctx, overlays, view);

  const num = (id, d) => parseFloat($(id).value) || d;
  const on = (id) => $(id).checked;
  const F = { frameW: frame.w, frameH: frame.h };
  if (on("showTitle")) drawTitle(ctx, figTitle(fig), {
    ...F, anchor: $("titlePos").value, offX: num("titleX", 0), offY: num("titleY", 0), fontSize: num("titleFont", 24),
  });
  if (on("showLegend")) drawLegend(ctx, legendBands(fig.paramName, o), {
    ...F, anchor: $("legendPos").value, offX: num("legendX", 0), offY: num("legendY", 0), fontSize: num("legendFont", 20),
  });
  if (on("showNorth")) drawNorthArrow(ctx, {
    ...F, anchor: $("naPos").value, offX: num("naX", 0), offY: num("naY", 0), radius: num("naSize", 46), rotRad: view.rotRad,
  });
  if (on("showScale")) drawScaleBar(ctx, {
    ...F, anchor: $("sbPos").value, offX: num("sbX", 0), offY: num("sbY", 0),
    ftPerPixel: ftPerPixel(view, fig.proj.latRad), sizeScale: num("sbSize", 1.4), segments: num("sbSegments", 4),
  });
  if (on("showAnnos")) drawAnnotations(ctx, view, annotations);
}

// ---- view + legend controls (live re-render from the cached scene) ----
$("orientation").addEventListener("change", () => scene && render());
for (const id of [
  "legendPos", "legendX", "legendY", "legendFont",
  "titlePos", "titleX", "titleY", "titleFont", "titleText",
  "naPos", "naX", "naY", "naSize",
  "sbPos", "sbX", "sbY", "sbSize", "sbSegments",
]) $(id).addEventListener("input", () => scene && render());

// legend SCALE (min/max/interval/ramp) is pinned to the current parameter and
// reused by the report, so edit it here and it sticks for that parameter.
for (const id of ["legendMin", "legendMax", "legendStep"])
  $(id).addEventListener("input", () => { storeLegend(); scene && render(); });
$("legendRamp").addEventListener("input", () => { storeLegend(); updateRampPreview(); scene && render(); });

// ---- visual color-ramp picker: a custom dropdown that shows each ramp's colors ----
const rampGradient = (key) => {
  const s = RAMPS[key];
  return s ? `linear-gradient(to right, ${s.map(([p, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(p * 100)}%`).join(", ")})` : "";
};
const rampLabel = (key) => (RAMP_OPTIONS.find((o) => o[0] === key) || [key, key])[1];
function buildRampMenu() {
  $("rampMenu").innerHTML = RAMP_OPTIONS.map(([key, label]) =>
    `<button type="button" class="ramp-opt" role="option" data-key="${key}"><span class="ramp-opt-name">${label}</span><span class="ramp-opt-sw" style="background:${rampGradient(key)}"></span></button>`).join("");
  $("rampMenu").querySelectorAll(".ramp-opt").forEach((btn) => btn.addEventListener("click", () => {
    $("legendRamp").value = btn.dataset.key;
    $("legendRamp").dispatchEvent(new Event("input", { bubbles: true }));   // → storeLegend + updateRampPreview + render
    closeRampMenu();
  }));
}
function updateRampPreview() {                       // sync the trigger swatch + menu selection from #legendRamp
  const key = $("legendRamp").value;
  if (!RAMPS[key]) return;
  $("rampTriggerName").textContent = rampLabel(key);
  $("rampTriggerSw").style.background = rampGradient(key);
  $("rampMenu").querySelectorAll(".ramp-opt").forEach((b) => b.classList.toggle("sel", b.dataset.key === key));
}
const closeRampMenu = () => { $("rampMenu").hidden = true; $("rampTrigger").setAttribute("aria-expanded", "false"); };
const openRampMenu = () => { $("rampMenu").hidden = false; $("rampTrigger").setAttribute("aria-expanded", "true"); };
$("rampTrigger").addEventListener("click", (e) => { e.stopPropagation(); $("rampMenu").hidden ? openRampMenu() : closeRampMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest("#rampCtl")) closeRampMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRampMenu(); });
buildRampMenu();
updateRampPreview();

// title template: prefill with the default, live preview, and token chips that
// insert at the cursor (each figure fills the tokens with its own values)
$("titleText").value = DEFAULT_TITLE_TEMPLATE;
$("titleText").addEventListener("input", updateTitlePreview);
updateTitlePreview();
document.querySelectorAll(".token").forEach((btn) => btn.addEventListener("click", () => {
  const inp = $("titleText"), tok = btn.dataset.token;
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e);
  const pos = s + tok.length; inp.focus(); inp.setSelectionRange(pos, pos);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}));
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

// =================== annotations: map-anchored labels + arrows ===================
function addAnnotation(type) {
  const bb = commonBbox();                                       // seed at the shared-extent centroid
  const ax = isFinite(bb.x0) ? (bb.x0 + bb.x1) / 2 : 0;
  const ay = isFinite(bb.y0) ? (bb.y0 + bb.y1) / 2 : 0;
  const base = { id: ++annoSeq, type, ax, ay, ox: 0, oy: 0, visible: true };
  annotations.push(type === "arrow"
    ? { ...base, color: "#ff3b30", length: 140, angle: 0, thickness: 5 }
    : { ...base, color: "#000000", text: "Label", fontSize: 30, halo: false });
  renderAnnoList();
  scene && render();
}
let placingId = null;                                           // annotation awaiting a map click
function beginPlacing(id) {
  placingId = id;
  $("figure").classList.add("placing");
  msg("Click on the map to place this annotation. (Esc to cancel.)", "ok");
}
function cancelPlacing() {
  if (placingId == null) return;
  placingId = null;
  $("figure").classList.remove("placing");
}
$("figure").addEventListener("click", (e) => {
  if (placingId == null || !scene) return;
  const cv = $("figure"), rect = cv.getBoundingClientRect();
  const fx = (e.clientX - rect.left) * (cv.width / rect.width);  // CSS px → frame px
  const fy = (e.clientY - rect.top) * (cv.height / rect.height);
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const view = makeView(commonBbox(), { w: frame.w, h: frame.h, rotDeg, zoom, panX, panY });
  const m = view.screenToMerc(fx, fy);
  const a = annotations.find((x) => x.id === placingId);
  if (a) { a.ax = m.x; a.ay = m.y; a.ox = 0; a.oy = 0; }         // drop it exactly where clicked
  cancelPlacing();
  render();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cancelPlacing(); });
function removeAnnotation(id) {
  annotations = annotations.filter((a) => a.id !== id);
  renderAnnoList();
  scene && render();
}
function renderAnnoList() {
  const host = $("annoList"); host.innerHTML = "";
  $("annoEmpty").hidden = annotations.length > 0;
  annotations.forEach((a, i) => host.appendChild(annoCard(a, i)));
}
function annoCard(a, i) {
  const card = document.createElement("div");
  card.className = "anno-card";
  const isArrow = a.type === "arrow";
  card.innerHTML = `
    <div class="anno-head">
      <input type="checkbox" class="anno-vis" ${a.visible ? "checked" : ""} title="Show on figure" />
      <span class="anno-type">${isArrow ? "Arrow" : "Label"} ${i + 1}</span>
      <input type="color" class="anno-color" value="${a.color}" title="Text/arrow color" />
      <button type="button" class="anno-del" title="Delete">✕</button>
    </div>
    ${isArrow ? `
      <div class="row2">
        <label class="inline">Length <input type="number" class="anno-len" value="${a.length}" min="10" max="900" step="10" /></label>
        <label class="inline">Rotate <input type="number" class="anno-ang" value="${a.angle}" step="5" /> °</label>
      </div>
      <label class="inline">Thickness <input type="number" class="anno-th" value="${a.thickness}" min="1" max="30" step="1" /></label>`
    : `
      <input type="text" class="anno-text" value="${(a.text || "").replace(/"/g, "&quot;")}" placeholder="Label text" />
      <div class="row2">
        <label class="inline">Font size <input type="number" class="anno-font" value="${a.fontSize}" min="8" max="120" step="1" /></label>
        <label class="chk"><input type="checkbox" class="anno-halo" ${a.halo ? "checked" : ""} /> Halo</label>
      </div>`}
    <div class="anno-nudge">
      <span class="ctrl-lbl">Move</span>
      <div class="dpad">
        <button type="button" class="nU" title="Up">▲</button>
        <button type="button" class="nL" title="Left">◀</button>
        <button type="button" class="nD" title="Down">▼</button>
        <button type="button" class="nR" title="Right">▶</button>
      </div>
      <button type="button" class="anno-place" title="Then click the map to drop it there">◎ Place on map</button>
    </div>`;
  const q = (s) => card.querySelector(s);
  const upd = () => scene && render();
  q(".anno-vis").addEventListener("change", (e) => { a.visible = e.target.checked; upd(); });
  q(".anno-color").addEventListener("input", (e) => { a.color = e.target.value; upd(); });
  q(".anno-del").addEventListener("click", () => removeAnnotation(a.id));
  if (isArrow) {
    q(".anno-len").addEventListener("input", (e) => { a.length = parseFloat(e.target.value) || a.length; upd(); });
    q(".anno-ang").addEventListener("input", (e) => { a.angle = parseFloat(e.target.value) || 0; upd(); });
    q(".anno-th").addEventListener("input", (e) => { a.thickness = parseFloat(e.target.value) || a.thickness; upd(); });
  } else {
    q(".anno-text").addEventListener("input", (e) => { a.text = e.target.value; upd(); });
    q(".anno-font").addEventListener("input", (e) => { a.fontSize = parseFloat(e.target.value) || a.fontSize; upd(); });
    q(".anno-halo").addEventListener("change", (e) => { a.halo = e.target.checked; upd(); });
  }
  q(".anno-place").addEventListener("click", () => beginPlacing(a.id));
  q(".nU").addEventListener("click", () => { a.oy -= ANNO_NUDGE; upd(); });
  q(".nD").addEventListener("click", () => { a.oy += ANNO_NUDGE; upd(); });
  q(".nL").addEventListener("click", () => { a.ox -= ANNO_NUDGE; upd(); });
  q(".nR").addEventListener("click", () => { a.ox += ANNO_NUDGE; upd(); });
  return card;
}
$("addLabel").addEventListener("click", () => addAnnotation("label"));
$("addArrow").addEventListener("click", () => addAnnotation("arrow"));

// =================== report builder ===================
const condLabelFull = (k) => ({ EX: "Existing Conditions", PR: "Proposed Conditions" }[k] || "Conditions");
const PARAM_ORDER = { shear: 0, velocity: 1, depth: 2, wse: 3, froude: 4 };
const COND_ORDER = { EX: 0, PR: 1 };
function evRank(e) {
  const climate = /\b20\d\d\b/.test(e);
  const nums = (e.match(/\d+/g) || []).map(Number);
  const interval = climate ? (nums.find((n) => n < 2000) ?? 9999) : (nums[0] ?? 9999);
  return (climate ? 100000 : 0) + interval;
}

function availableParams() {
  const m = new Map();
  for (const { run } of allRuns()) for (const p of Object.keys(run.params)) if (!run.params[p].vector) m.set(p, paramDef(p).label);
  return [...m.entries()];
}

function refreshReport() {
  const runs = allRuns();
  $("report").hidden = !runs.length;
  if (!runs.length) return;
  $("rpParams").innerHTML = availableParams().map(([p, l]) => `<label class="chk"><input type="checkbox" class="rp-param" value="${p}" checked /> ${l}</label>`).join("");
  $("rpRuns").innerHTML = runs.map((r, i) => `<label class="chk"><input type="checkbox" class="rp-run" value="${i}" checked /> ${runLabel(r.run.name)}</label>`).join("");
}

function selectedFigs() {
  const params = [...document.querySelectorAll(".rp-param:checked")].map((c) => c.value);
  const runs = allRuns();
  const figs = [];
  for (const c of document.querySelectorAll(".rp-run:checked")) {
    const sel = runs[+c.value];
    for (const p of params) if (sel.run.params[p] && !sel.run.params[p].vector) figs.push(buildFig(sel, p));
  }
  const mode = $("rpOrganize").value;
  const byP = (f) => PARAM_ORDER[f.def.key] ?? 9, byC = (f) => COND_ORDER[f.condKey] ?? 9, byE = (f) => evRank(f.event);
  const order = { condition: [byC, byP, byE], parameter: [byP, byC, byE], event: [byE, byP, byC], comparison: [byP, byE, byC] }[mode] || [byC, byP, byE];
  figs.sort((a, b) => { for (const k of order) { const d = k(a) - k(b); if (d) return d; } return 0; });
  return figs;
}

async function renderFigs(figs) {
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const out = [];
  for (let i = 0; i < figs.length; i++) {
    msg(`Rendering figure ${i + 1} of ${figs.length}…`, "ok");
    const cv = document.createElement("canvas"); cv.width = frame.w; cv.height = frame.h;
    await composeFigure(cv.getContext("2d"), frame, figs[i]);
    out.push({ fig: figs[i], canvas: cv });
  }
  return out;
}

function paginate(rendered, perPage, mode, opts) {
  const gk = (f) => mode === "condition" ? f.condKey : mode === "parameter" ? f.def.key : mode === "event" ? f.event : f.def.key + "|" + f.event;
  const gl = (f) => mode === "condition" ? condLabelFull(f.condKey) : mode === "parameter" ? f.def.label : mode === "event" ? f.event : `${f.event} ${f.def.label}`;
  const groups = [];
  for (const r of rendered) { const k = gk(r.fig); if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, label: gl(r.fig), items: [] }); groups[groups.length - 1].items.push(r); }
  const pages = [];
  for (const g of groups) for (let i = 0; i < g.items.length; i += perPage) {
    const page = { items: g.items.slice(i, i + perPage) };
    if (opts.headings && i === 0) page.heading = g.label;
    pages.push(page);
  }
  return pages;
}

// The Word page follows the step-2 orientation; figures fill the usable area.
function pageDims() {
  const landscape = $("orientation").value === "landscape";
  return landscape ? { wIn: 11, hIn: 8.5, landscape: true } : { wIn: 8.5, hIn: 11, landscape: false };
}
function figSizeIn(perPage) {
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const aspect = frame.w / frame.h;                 // figure aspect == page aspect
  const pg = pageDims(), m = 0.75;
  const usableW = pg.wIn - 2 * m, usableH = pg.hIn - 2 * m;
  const slotH = (usableH - (perPage === 2 ? 0.7 : 0.35)) / perPage; // leave room for caption/heading
  const w = Math.min(usableW, slotH * aspect);
  return { widthIn: w, heightIn: w / aspect, usableW };
}

async function buildPages() {
  const figs = selectedFigs();
  if (!figs.length) { msg("Pick at least one parameter and run for the report.", "err"); return null; }
  const rendered = await renderFigs(figs);
  const mode = $("rpOrganize").value, perPage = +$("rpPerPage").value;
  const opts = { captions: $("rpCaption").checked, headings: $("rpHeadings").checked };
  return { pages: paginate(rendered, perPage, mode, opts), opts, total: rendered.length };
}

function pngBytes(canvas) {
  const bin = atob(canvas.toDataURL("image/png").split(",")[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function downloadBlob(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Button busy-state with a spinner, so long report builds show progress.
async function setBusy(btn, label) {
  btn.dataset.label = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  btn.disabled = true;
  await new Promise((r) => setTimeout(r, 0));           // let the spinner paint before heavy work
}
function clearBusy(btn) {
  if (btn.dataset.label != null) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
  btn.disabled = false;
}

async function previewReport() {
  await setBusy($("rpPreview"), "Building…");
  try {
    const built = await buildPages();
    if (!built) return;
    const sz = figSizeIn(+$("rpPerPage").value);
    const pg2 = pageDims();
    // Render each preview page as an exact scaled replica of the Word page:
    // one px-per-inch scale drives page size, the 0.75in margins, and figures.
    const PXW = pg2.landscape ? 900 : 680;          // page width on screen (px)
    const scale = PXW / pg2.wIn;                     // px per inch
    const margin = 0.75 * scale;                     // same 0.75in margin as the docx
    const host = $("previewHost"); host.innerHTML = "";
    built.pages.forEach((pg, i) => {
      const wrap = document.createElement("div"); wrap.className = "pv-pagewrap";
      const el = document.createElement("div"); el.className = "pv-page";
      el.style.width = PXW + "px";
      el.style.height = pg2.hIn * scale + "px";       // exact page, not content-driven
      el.style.padding = margin + "px";
      el.style.gap = 0.12 * scale + "px";
      if (pg.heading) { const h = document.createElement("div"); h.className = "pv-heading"; h.textContent = pg.heading; el.appendChild(h); }
      for (const it of pg.items) {
        const fig = document.createElement("div"); fig.className = "pv-fig";
        const img = document.createElement("img"); img.src = it.canvas.toDataURL("image/png");
        img.style.width = sz.widthIn * scale + "px";
        img.style.height = sz.heightIn * scale + "px";
        fig.appendChild(img);
        if (built.opts.captions) { const cap = document.createElement("div"); cap.className = "pv-cap"; cap.textContent = figTitle(it.fig); fig.appendChild(cap); }
        el.appendChild(fig);
      }
      wrap.appendChild(el);
      const num = document.createElement("div"); num.className = "pv-num"; num.textContent = `Page ${i + 1} of ${built.pages.length}`;
      wrap.appendChild(num);                            // label sits below the page, not inside it
      host.appendChild(wrap);
    });
    $("previewModal").hidden = false;
    msg(`Preview ready: ${built.total} figures on ${built.pages.length} pages.`, "ok");
  } catch (e) { msg(e.message, "err"); console.error(e); }
  finally { clearBusy($("rpPreview")); }
}

async function generateWord() {
  await setBusy($("rpWord"), "Generating…");
  try {
    const built = await buildPages();
    if (!built) return;
    const sz = figSizeIn(+$("rpPerPage").value);
    const docPages = built.pages.map((pg) => ({
      heading: pg.heading,
      figures: pg.items.map((it) => ({ png: pngBytes(it.canvas), caption: built.opts.captions ? figTitle(it.fig) : "", widthIn: sz.widthIn, heightIn: sz.heightIn })),
    }));
    downloadBlob(buildReportDocx(docPages, { landscape: pageDims().landscape }), "Appendix_K_Report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    msg(`Word report downloaded: ${built.total} figures on ${built.pages.length} pages.`, "ok");
  } catch (e) { msg(e.message, "err"); console.error(e); }
  finally { clearBusy($("rpWord")); }
}

$("rpPreview").addEventListener("click", previewReport);
$("rpWord").addEventListener("click", generateWord);
$("previewClose").addEventListener("click", () => { $("previewModal").hidden = true; });
$("rpSelectAllParams").addEventListener("click", () => document.querySelectorAll(".rp-param").forEach((c) => (c.checked = true)));
$("rpSelectAllRuns").addEventListener("click", () => document.querySelectorAll(".rp-run").forEach((c) => (c.checked = true)));

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
