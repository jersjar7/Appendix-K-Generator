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
import { buildReportDocx } from "./reportdoc.js";

const $ = (id) => document.getElementById(id);
let ready = false;
// per-condition meshes, keyed EX/PR/… : { geom, dFile, datasets, proj }
// proj = reprojected mesh { N, tris, mx, my, z, bbox, latRad } (done once at load)
const conditions = new Map();
const getCond = (k) => { if (!conditions.has(k)) conditions.set(k, {}); return conditions.get(k); };
const condKey = (name) => {
  const m = /\b(EX|PR)\b/i.exec(name) || /(EX|PR)_Mesh/i.exec(name);
  return m ? m[1].toUpperCase() : "DEFAULT";
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
    if (isGeometryFile(h)) { const g = readGeometry(h); getCond(condKey(g.meshName)).proj = projectMesh(g); }
    else if (isDatasetsFile(h)) { const ds = readDatasets(h); const c = getCond(condKey(ds.runs[0] ? ds.runs[0].name : "")); c.dFile = h; c.datasets = ds; }
  }
  refreshStatus();
});

function refreshStatus() {
  const lines = [];
  for (const [k, c] of conditions) {
    lines.push(`<div><strong>${condLabel(k)}:</strong> ${c.proj ? `geometry ✓ (${c.proj.N} nodes)` : "geometry ✕"} · ${c.datasets ? `datasets ✓ (${c.datasets.runs.length} runs)` : "datasets ✕"}</div>`);
  }
  setStatus(lines.length ? lines.join("") : "<div>— drop the geometry + datasets .h5 for each mesh</div>");

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
    condKey: key, event: eventOf(run.name),
    title: `${runLabel(run.name)} — ${def.label}${def.units ? " (" + def.units + ")" : ""}`,
    fileBase: `${runLabel(run.name).replace(/\W+/g, "_")}_${def.key}`,
    defRamp: def.ramp, defCount: Math.max(2, Math.round((nb.max - nb.min) / nb.step)), wetMax: hi,
  };
}

async function generate() {
  const sel = allRuns()[+$("run").value];
  if (!sel) return;
  scene = buildFig(sel, $("param").value);
  $("legendIntervals").value = scene.defCount;   // seed legend controls for live edits
  $("legendRamp").value = scene.defRamp;
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
  await composeFigure(cv.getContext("2d"), frame, scene, {
    ramp: $("legendRamp").value,
    count: Math.min(60, Math.max(2, parseInt($("legendIntervals").value, 10) || scene.defCount)),
  });
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
async function composeFigure(ctx, frame, fig, { ramp, count }) {
  const view = makeView(commonBbox(), { w: frame.w, h: frame.h, rotDeg, zoom, panX, panY });
  ctx.fillStyle = "#e7ebf0"; ctx.fillRect(0, 0, frame.w, frame.h);
  await drawBasemap(ctx, view, { url: ESRI_WORLD_IMAGERY });        // tiles cached across figures
  ctx.fillStyle = "rgba(255,255,255,0.42)"; ctx.fillRect(0, 0, frame.w, frame.h);

  const o = { min: fig.range.min, max: fig.range.max, interval: (fig.range.max - fig.range.min) / count, ramp };

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
  if (on("showTitle")) drawTitle(ctx, fig.title, {
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
    await composeFigure(cv.getContext("2d"), frame, figs[i], { ramp: figs[i].defRamp, count: figs[i].defCount });
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

function figSizeIn(perPage) {
  const frame = FRAMES[$("orientation").value] || FRAMES.landscape;
  const aspect = frame.w / frame.h;
  const w = Math.min(6.5, (perPage === 2 ? 4.0 : 8.4) * aspect);
  return { widthIn: w, heightIn: w / aspect };
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

async function previewReport() {
  $("rpPreview").disabled = true;
  try {
    const built = await buildPages();
    if (!built) return;
    const sz = figSizeIn(+$("rpPerPage").value);
    const host = $("previewHost"); host.innerHTML = "";
    built.pages.forEach((pg, i) => {
      const el = document.createElement("div"); el.className = "pv-page";
      if (pg.heading) { const h = document.createElement("div"); h.className = "pv-heading"; h.textContent = pg.heading; el.appendChild(h); }
      for (const it of pg.items) {
        const fig = document.createElement("div"); fig.className = "pv-fig";
        const img = document.createElement("img"); img.src = it.canvas.toDataURL("image/png");
        img.style.width = (sz.widthIn / 7 * 100) + "%";
        fig.appendChild(img);
        if (built.opts.captions) { const cap = document.createElement("div"); cap.className = "pv-cap"; cap.textContent = it.fig.title; fig.appendChild(cap); }
        el.appendChild(fig);
      }
      const num = document.createElement("div"); num.className = "pv-num"; num.textContent = `Page ${i + 1} of ${built.pages.length}`;
      el.appendChild(num);
      host.appendChild(el);
    });
    $("previewModal").hidden = false;
    msg(`Preview ready: ${built.total} figures on ${built.pages.length} pages.`, "ok");
  } catch (e) { msg(e.message, "err"); console.error(e); }
  finally { $("rpPreview").disabled = false; }
}

async function generateWord() {
  $("rpWord").disabled = true;
  try {
    const built = await buildPages();
    if (!built) return;
    const sz = figSizeIn(+$("rpPerPage").value);
    const docPages = built.pages.map((pg) => ({
      heading: pg.heading,
      figures: pg.items.map((it) => ({ png: pngBytes(it.canvas), caption: built.opts.captions ? it.fig.title : "", widthIn: sz.widthIn, heightIn: sz.heightIn })),
    }));
    downloadBlob(buildReportDocx(docPages), "Appendix_K_Report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    msg(`Word report downloaded: ${built.total} figures on ${built.pages.length} pages.`, "ok");
  } catch (e) { msg(e.message, "err"); console.error(e); }
  finally { $("rpWord").disabled = false; }
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
