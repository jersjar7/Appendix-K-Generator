import * as h5wasm from "../vendor/h5wasm/hdf5_hl.js";
import { readGeometry, readDatasets, finalTimestep, isGeometryFile, isDatasetsFile } from "./h5.js";
import { toLonLat, lonLatToMerc } from "./geo.js";
import { makeColorFn, legendBands, paramDef } from "./ramps.js";
import { fillMesh } from "./contour.js";
import { makeView, FRAMES, ftPerPixel } from "./view.js";
import { drawTitle, drawLegend, drawNorthArrow, drawScaleBar } from "./render.js";
import { drawBasemap, ESRI_WORLD_IMAGERY, USGS_IMAGERY } from "./tiles.js";

const $ = (id) => document.getElementById(id);
let geom = null, datasets = null, dFile = null, ready = false;
let scene = null;        // cached generated figure (so rotation/orientation are instant)
let rotDeg = 0, zoom = 1, panX = 0, panY = 0;
const PAN_STEP = 120;    // screen px per pan click (frame coords)

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
  $("generate").disabled = !(geom && datasets);
}

function populateParams() {
  const run = datasets.runs[+$("run").value];
  const scalars = Object.keys(run.params).filter((p) => !run.params[p].vector);
  $("param").innerHTML = scalars.map((p) => `<option value="${p}">${paramDef(p).label}</option>`).join("");
}
$("run").addEventListener("change", populateParams);

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
  const autoMax = niceMax(hi);
  const opts = def.range ? { min: def.range[0], max: def.range[1] }
    : { min: 0, max: autoMax, interval: niceStep(autoMax / 12) };

  scene = {
    mx, my, tris: geom.tris, values, def, paramName, opts,
    bbox: { x0, x1, y0, y1 }, latRad: (lat.reduce((a, b) => a + b, 0) / lat.length) * Math.PI / 180,
    title: `${runLabel(run.name)} — ${def.label}${def.units ? " (" + def.units + ")" : ""}`,
    fileBase: `${runLabel(run.name).replace(/\W+/g, "_")}_${def.key}`,
    wetMax: hi,
  };
  await render();
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

  const bm = $("basemap").value;
  if (bm !== "none") await drawBasemap(ctx, view, { url: bm === "usgs" ? USGS_IMAGERY : ESRI_WORLD_IMAGERY });

  // fade the aerial so contours read on top
  if (bm !== "none") { ctx.fillStyle = "rgba(255,255,255,0.42)"; ctx.fillRect(0, 0, frame.w, frame.h); }

  // contours, rotated with the map (shares the panned origin)
  ctx.save();
  ctx.translate(view.originX, view.originY); ctx.rotate(view.rotRad);
  const N = scene.mx.length, lx = new Float64Array(N), ly = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = view.toLocal(scene.mx[i], scene.my[i]); lx[i] = p[0]; ly[i] = p[1]; }
  fillMesh(ctx, lx, ly, scene.tris, scene.values, makeColorFn(scene.paramName, scene.opts));
  ctx.restore();

  // upright overlays — each placeable + sizable via its own controls
  const num = (id, d) => parseFloat($(id).value) || d;
  const F = { frameW: frame.w, frameH: frame.h };
  drawTitle(ctx, scene.title, {
    ...F, anchor: $("titlePos").value, offX: num("titleX", 0), offY: num("titleY", 0), fontSize: num("titleFont", 24),
  });
  drawLegend(ctx, legendBands(scene.paramName, scene.opts), {
    ...F, anchor: $("legendPos").value, offX: num("legendX", 0), offY: num("legendY", 0), fontSize: num("legendFont", 20),
  });
  drawNorthArrow(ctx, {
    ...F, anchor: $("naPos").value, offX: num("naX", 0), offY: num("naY", 0), radius: num("naSize", 46), rotRad: view.rotRad,
  });
  drawScaleBar(ctx, {
    ...F, anchor: $("sbPos").value, offX: num("sbX", 0), offY: num("sbY", 0),
    ftPerPixel: ftPerPixel(view, scene.latRad), sizeScale: num("sbSize", 1.4),
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
$("basemap").addEventListener("change", () => scene && render());
for (const id of [
  "legendPos", "legendX", "legendY", "legendFont",
  "titlePos", "titleX", "titleY", "titleFont",
  "naPos", "naX", "naY", "naSize",
  "sbPos", "sbX", "sbY", "sbSize",
]) $(id).addEventListener("input", () => scene && render());
function setRot(deg) { rotDeg = ((deg % 360) + 360) % 360; $("rot").value = rotDeg; scene && render(); }
$("rotCCW").addEventListener("click", () => setRot(rotDeg - 90));
$("rotCW").addEventListener("click", () => setRot(rotDeg + 90));
$("rot").addEventListener("change", () => setRot(parseFloat($("rot").value) || 0));

// ---- zoom + pan (panel-only) ----
const rerender = () => scene && render();
$("zoomIn").addEventListener("click", () => { zoom *= 1.25; rerender(); });
$("zoomOut").addEventListener("click", () => { zoom /= 1.25; rerender(); });
$("panL").addEventListener("click", () => { panX -= PAN_STEP; rerender(); });
$("panR").addEventListener("click", () => { panX += PAN_STEP; rerender(); });
$("panU").addEventListener("click", () => { panY -= PAN_STEP; rerender(); });
$("panD").addEventListener("click", () => { panY += PAN_STEP; rerender(); });
$("viewReset").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; rotDeg = 0; $("rot").value = 0; rerender(); });

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
