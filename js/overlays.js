// Draw uploaded shapefile overlays (centerline, stationing, boundaries, …) on
// the figure. shpjs returns GeoJSON already reprojected to WGS84 lon/lat, so we
// just go lon/lat → Web Mercator → view-local, the same path as the mesh. Drawn
// inside the rotated/zoomed/panned context, so overlays track the map.

const R = 6378137;
const GROUND_RADIUS_METERS = 6371008.8;
const FEET_PER_METER = 3.280839895;
const MAX_STATION_TICKS = 1200;
function toMerc(lon, lat) {
  return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2)) * R];
}
function project(view, lon, lat) {
  const [mx, my] = toMerc(lon, lat);
  return view.toLocal(mx, my);
}

export const OVERLAY_PALETTE = ["#e8112d", "#ffd400", "#00a3e0", "#8e44ad", "#ff7f0e", "#1abc9c"];

// overlays: [{ geojson, color, width, hidden }]. Call inside the rotated ctx.
export function drawOverlays(ctx, overlays, view) {
  for (const ov of overlays) {
    if (ov.hidden) continue;
    ctx.save();
    ctx.strokeStyle = ov.color;
    ctx.fillStyle = ov.color;
    ctx.lineWidth = ov.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const f of ov.geojson.features || []) if (f.geometry) drawGeom(ctx, f.geometry, view, ov);
    ctx.restore();
  }
}

export function drawOverlayStationTicks(ctx, overlays, view) {
  for (const ov of overlays) {
    if (ov.hidden || !ov.stationing) continue;
    const ticks = stationTicksForGeojson(ov.geojson, ov);
    if (!ticks.length) continue;
    const color = ov.stationColor || ov.color;
    const baseLength = Math.max(4, Number(ov.stationTickLength) || 16);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "butt";
    for (const tick of ticks) {
      const point = project(view, tick.coordinate[0], tick.coordinate[1]);
      const before = project(view, tick.segmentStart[0], tick.segmentStart[1]);
      const after = project(view, tick.segmentEnd[0], tick.segmentEnd[1]);
      const dx = after[0] - before[0], dy = after[1] - before[1];
      const magnitude = Math.hypot(dx, dy);
      if (!magnitude) continue;
      const nx = -dy / magnitude, ny = dx / magnitude;
      const half = baseLength * (tick.major ? 0.72 : 0.46);
      ctx.lineWidth = tick.major ? 2.2 : 1.35;
      ctx.beginPath();
      ctx.moveTo(point[0] - nx * half, point[1] - ny * half);
      ctx.lineTo(point[0] + nx * half, point[1] + ny * half);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawGeom(ctx, geom, view, ov) {
  const c = geom.coordinates;
  switch (geom.type) {
    case "Point": marker(ctx, project(view, c[0], c[1]), ov.width); break;
    case "MultiPoint": for (const p of c) marker(ctx, project(view, p[0], p[1]), ov.width); break;
    case "LineString": stroke(ctx, c, view, false); break;
    case "MultiLineString": for (const l of c) stroke(ctx, l, view, false); break;
    case "Polygon": for (const r of c) stroke(ctx, r, view, true); break;
    case "MultiPolygon": for (const poly of c) for (const r of poly) stroke(ctx, r, view, true); break;
  }
}

function stroke(ctx, coords, view, close) {
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const [x, y] = project(view, coords[i][0], coords[i][1]);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  if (close) ctx.closePath();
  ctx.stroke();
}

function marker(ctx, [x, y], w) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2.5, w * 1.4), 0, Math.PI * 2);
  ctx.fill();
}

// ---- labels (drawn UPRIGHT in screen space, after the rotated layer) ----

// local (rotated-layer) coords → final screen pixel
function localToScreen(view, lx, ly) {
  const c = Math.cos(view.rotRad), s = Math.sin(view.rotRad);
  return [view.originX + lx * c - ly * s, view.originY + lx * s + ly * c];
}
function lonLatToScreen(view, lon, lat) {
  const [mx, my] = toMerc(lon, lat);
  const [lx, ly] = view.toLocal(mx, my);
  return localToScreen(view, lx, ly);
}
const mid = (a) => a[Math.floor(a.length / 2)];
function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}
function labelAnchors(geom) {
  switch (geom.type) {
    case "Point": return [geom.coordinates];
    case "MultiPoint": return geom.coordinates;
    case "LineString": return [mid(geom.coordinates)];
    case "MultiLineString": return geom.coordinates.map(mid);
    case "Polygon": return [centroid(geom.coordinates[0])];
    case "MultiPolygon": return geom.coordinates.map((poly) => centroid(poly[0]));
    default: return [];
  }
}

const MAX_LABELS = 600; // guard against labeling a huge point set

export function drawOverlayLabels(ctx, overlays, view) {
  for (const ov of overlays) {
    if (ov.hidden || !ov.labelField) continue;
    const fs = ov.labelSize || 22;
    ctx.save();
    ctx.font = `${fs}px Arial, sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, fs * 0.2); ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.fillStyle = "#111";
    let drawn = 0;
    for (const f of ov.geojson.features || []) {
      if (drawn >= MAX_LABELS) break;
      if (!f.geometry || !f.properties) continue;
      const txt = f.properties[ov.labelField];
      if (txt == null || txt === "") continue;
      for (const [lon, lat] of labelAnchors(f.geometry)) {
        const [sx, sy] = lonLatToScreen(view, lon, lat);
        ctx.strokeText(String(txt), sx + fs * 0.45, sy);
        ctx.fillText(String(txt), sx + fs * 0.45, sy);
        if (++drawn >= MAX_LABELS) break;
      }
    }
    ctx.restore();
  }
}

export function drawOverlayStationLabels(ctx, overlays, view) {
  for (const ov of overlays) {
    if (ov.hidden || !ov.stationing) continue;
    const ticks = stationTicksForGeojson(ov.geojson, ov);
    const fontSize = Math.max(8, Number(ov.stationLabelSize) || 18);
    const tickLength = Math.max(4, Number(ov.stationTickLength) || 16);
    const color = ov.stationColor || ov.color;
    ctx.save();
    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, fontSize * 0.24);
    ctx.strokeStyle = "rgba(255,255,255,0.96)";
    ctx.fillStyle = color;
    for (const tick of ticks) {
      if (!tick.major) continue;
      const point = lonLatToScreen(view, tick.coordinate[0], tick.coordinate[1]);
      const before = lonLatToScreen(view, tick.segmentStart[0], tick.segmentStart[1]);
      const after = lonLatToScreen(view, tick.segmentEnd[0], tick.segmentEnd[1]);
      const dx = after[0] - before[0], dy = after[1] - before[1];
      const magnitude = Math.hypot(dx, dy);
      if (!magnitude) continue;
      const nx = -dy / magnitude, ny = dx / magnitude;
      const offset = tickLength * 0.9 + fontSize * 0.58;
      const x = point[0] + nx * offset, y = point[1] + ny * offset;
      const text = formatStation(tick.station);
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }
}

function linePaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries || []).flatMap(linePaths);
  }
  return [];
}

function groundDistanceFeet(first, second) {
  const lat1 = first[1] * Math.PI / 180, lat2 = second[1] * Math.PI / 180;
  const dLat = lat2 - lat1, dLon = (second[0] - first[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * GROUND_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a))) * FEET_PER_METER;
}

function pathDistances(path) {
  const distances = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) {
    distances[i] = distances[i - 1] + groundDistanceFeet(path[i - 1], path[i]);
  }
  return distances;
}

function longestLinePath(geojson) {
  let longest = null, longestLength = -1;
  for (const feature of geojson?.features || []) {
    for (const path of linePaths(feature.geometry)) {
      if (!Array.isArray(path) || path.length < 2) continue;
      const distances = pathDistances(path);
      const length = distances.at(-1);
      if (length > longestLength) {
        longest = path;
        longestLength = length;
      }
    }
  }
  return longest;
}

function nearMultiple(value, interval) {
  return Math.abs(value / interval - Math.round(value / interval)) < 1e-7;
}

export function stationTicksForGeojson(geojson, options = {}) {
  const sourcePath = longestLinePath(geojson);
  if (!sourcePath) return [];
  const path = options.stationDirection === "reverse"
    ? [...sourcePath].reverse()
    : sourcePath;
  const distances = pathDistances(path);
  const length = distances.at(-1);
  const start = Number.isFinite(Number(options.stationStart)) ? Number(options.stationStart) : 0;
  const tickInterval = Math.max(0.01, Number(options.stationTickInterval) || 50);
  const labelInterval = Math.max(tickInterval, Number(options.stationLabelInterval) || 100);
  const firstStation = Math.ceil((start - 1e-8) / tickInterval) * tickInterval;
  const endStation = start + length;
  const ticks = [];
  let segment = 1;

  for (
    let station = firstStation;
    station <= endStation + 1e-7 && ticks.length < MAX_STATION_TICKS;
    station += tickInterval
  ) {
    const offset = Math.max(0, station - start);
    while (segment < distances.length - 1 && distances[segment] < offset) segment++;
    const segmentStartDistance = distances[segment - 1];
    const segmentLength = distances[segment] - segmentStartDistance;
    if (segmentLength <= 0) continue;
    const fraction = Math.max(0, Math.min(1, (offset - segmentStartDistance) / segmentLength));
    const segmentStart = path[segment - 1], segmentEnd = path[segment];
    ticks.push({
      station,
      major: nearMultiple(station, labelInterval),
      coordinate: [
        segmentStart[0] + (segmentEnd[0] - segmentStart[0]) * fraction,
        segmentStart[1] + (segmentEnd[1] - segmentStart[1]) * fraction,
      ],
      segmentStart,
      segmentEnd,
    });
  }
  return ticks;
}

export function formatStation(station, decimalPlaces = 0) {
  if (!Number.isFinite(station)) return "—";
  const places = Math.max(0, Math.min(2, Math.trunc(decimalPlaces)));
  const factor = 10 ** places;
  const rounded = Math.round(Math.abs(station) * factor) / factor;
  let major = Math.floor(rounded / 100);
  let remainder = rounded - major * 100;
  if (Math.round(remainder * factor) >= 100 * factor) {
    major++;
    remainder = 0;
  }
  const remainderText = places
    ? remainder.toFixed(places).padStart(3 + places, "0")
    : Math.round(remainder).toString().padStart(2, "0");
  return `${station < 0 ? "-" : ""}${major}+${remainderText}`;
}

// Attribute field names available for labeling (sampled from the features).
export function propKeys(geojson) {
  const keys = new Set();
  for (const f of (geojson.features || []).slice(0, 50)) if (f.properties) Object.keys(f.properties).forEach((k) => keys.add(k));
  return [...keys];
}

// A short human description of what's in a parsed shapefile (for the UI list).
export function describe(geojson) {
  const kinds = new Set((geojson.features || []).map((f) => f.geometry && f.geometry.type).filter(Boolean));
  const n = (geojson.features || []).length;
  const kind = [...kinds].map((k) => k.replace("Multi", "").toLowerCase()).join("/") || "feature";
  return `${n} ${kind}${n === 1 ? "" : "s"}`;
}
