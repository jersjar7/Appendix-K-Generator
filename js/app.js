import * as h5wasm from "../vendor/h5wasm/hdf5_hl.js";
import { readGeometry, readDatasets, finalTimestep, isGeometryFile, isDatasetsFile } from "./h5.js";
import { toLonLat, lonLatToMerc } from "./geo.js";
import { makeColorFn, legendBands, paramDef } from "./ramps.js";
import { fitToScreen, fillMesh } from "./contour.js";
import { drawTitle, drawLegend, drawNorthArrow, drawScaleBar } from "./render.js";
import { drawBasemap, ESRI_WORLD_IMAGERY, USGS_IMAGERY } from "./tiles.js";

const $ = (id) => document.getElementById(id);
const PAD = 56;
let geom = null;          // { N, xy, z, tris, wkt }
let datasets = null;      // { runs: [{name, params}] }
let gFile = null, dFile = null;
let ready = false;

(async () => { await h5wasm.ready; ready = true; })();

function setStatus(html) { $("fileStatus").innerHTML = html; }
function msg(text, type = "ok") {
  $("messages").innerHTML = `<div class="msg-${type}">${text}</div>`;
}

// nicer run/param labels
function runLabel(name) {
  return name.replace(/\(SRH-2D\)/i, "").replace(/^EX\b/i, "Existing").replace(/^PR\b/i, "Proposed").trim();
}

$("files").addEventListener("change", async (e) => {
  if (!ready) await h5wasm.ready;
  for (const file of e.target.files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const fname = file.name.replace(/[^\w.]/g, "_");
    h5wasm.FS.writeFile(fname, buf);
    const h = new h5wasm.File(fname, "r");
    if (isGeometryFile(h)) { gFile = h; geom = readGeometry(h); }
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

  // project to web mercator (so a basemap can drop in later) and fit the canvas
  const { lon, lat } = toLonLat(geom.xy, geom.wkt);
  const { mx, my } = lonLatToMerc(lon, lat);
  const cv = $("figure"), ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);

  const { sx, sy, fit } = fitToScreen(mx, my, W, H, PAD);

  // faint aerial basemap underlay (best-effort; figure still renders if offline)
  const bm = $("basemap").value;
  if (bm !== "none") {
    await drawBasemap(ctx, fit, { url: bm === "usgs" ? USGS_IMAGERY : ESRI_WORLD_IMAGERY });
  }

  // wet-data range for auto-scaled params
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v > -900) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  const opts = def.range ? { min: def.range[0], max: def.range[1] } : { min: 0, max: niceMax(hi) };

  fillMesh(ctx, sx, sy, geom.tris, values, makeColorFn(paramName, opts));

  drawTitle(ctx, `${runLabel(run.name)} — ${def.label}${def.units ? " (" + def.units + ")" : ""}`, W);
  drawLegend(ctx, legendBands(paramName, opts), 24, 70);
  drawNorthArrow(ctx, W - 44, H - 66);
  const latMean = (lat.reduce((a, b) => a + b, 0) / lat.length) * Math.PI / 180;
  const ftPerPx = (1 / fit.s) * Math.cos(latMean) / 0.3048;
  drawScaleBar(ctx, 90, H - 30, ftPerPx);

  $("download").disabled = false;
  $("download").onclick = () => {
    const a = document.createElement("a");
    a.download = `${runLabel(run.name).replace(/\W+/g, "_")}_${def.key}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  };
  msg(`Generated ${runLabel(run.name)} ${def.label}. Wet max ${hi.toFixed(2)} ${def.units}.`, "ok");
}

function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 5, 10].map((m) => m * pow).find((n) => n >= v) || 10 * pow;
}
