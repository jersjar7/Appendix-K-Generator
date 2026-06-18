// Draw uploaded shapefile overlays (centerline, stationing, boundaries, …) on
// the figure. shpjs returns GeoJSON already reprojected to WGS84 lon/lat, so we
// just go lon/lat → Web Mercator → view-local, the same path as the mesh. Drawn
// inside the rotated/zoomed/panned context, so overlays track the map.

const R = 6378137;
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

// A short human description of what's in a parsed shapefile (for the UI list).
export function describe(geojson) {
  const kinds = new Set((geojson.features || []).map((f) => f.geometry && f.geometry.type).filter(Boolean));
  const n = (geojson.features || []).length;
  const kind = [...kinds].map((k) => k.replace("Multi", "").toLowerCase()).join("/") || "feature";
  return `${n} ${kind}${n === 1 ? "" : "s"}`;
}
