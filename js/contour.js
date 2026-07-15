// Fill a triangular mesh colored by a per-node scalar onto a 2D canvas context.
// Environment-agnostic (node-canvas or browser canvas). Triangles touching a dry
// node are skipped so only the wetted area is painted.

// Map projected coordinates (mx,my arrays, any linear units) to screen pixels,
// fitting [w×h] with `pad` px margin, equal aspect, Y flipped. Returns {sx,sy,fit}.
export function fitToScreen(mx, my, w, h, pad = 0) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < mx.length; i++) {
    if (mx[i] < x0) x0 = mx[i]; if (mx[i] > x1) x1 = mx[i];
    if (my[i] < y0) y0 = my[i]; if (my[i] > y1) y1 = my[i];
  }
  const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0));
  const ox = (w - s * (x1 - x0)) / 2, oy = (h - s * (y1 - y0)) / 2;
  const n = mx.length, sx = new Float64Array(n), sy = new Float64Array(n);
  for (let i = 0; i < n; i++) { sx[i] = ox + s * (mx[i] - x0); sy[i] = h - (oy + s * (my[i] - y0)); }
  return { sx, sy, fit: { x0, x1, y0, y1, s, ox, oy, w, h } };
}

export function fillMesh(ctx, sx, sy, tris, values, colorFn) {
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const va = values[a], vb = values[b], vc = values[c];
    if (va <= -900 || vb <= -900 || vc <= -900) continue; // any dry vertex → skip
    const col = colorFn((va + vb + vc) / 3);
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[c], sy[c]);
    ctx.closePath();
    ctx.fill();
  }
}

function addContourPoint(pts, x0, y0, x1, y1, v0, v1, level, valueEps) {
  const d0 = v0 - level, d1 = v1 - level;
  if (Math.abs(d0) <= valueEps && Math.abs(d1) <= valueEps) return; // flat contour edge
  if ((d0 < -valueEps && d1 < -valueEps) || (d0 > valueEps && d1 > valueEps)) return;

  const den = v1 - v0;
  if (Math.abs(den) <= valueEps) return;
  const f = (level - v0) / den;
  if (f < -1e-9 || f > 1 + 1e-9) return;

  const x = x0 + f * (x1 - x0), y = y0 + f * (y1 - y0);
  for (const p of pts) if (Math.abs(p[0] - x) < 0.01 && Math.abs(p[1] - y) < 0.01) return;
  pts.push([x, y]);
}

function farthestPair(pts) {
  let best = [pts[0], pts[1]], bestD = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], d = dx * dx + dy * dy;
    if (d > bestD) { bestD = d; best = [pts[i], pts[j]]; }
  }
  return best;
}

// Draw scalar contour/isoline segments through a triangular mesh. The renderer
// uses the same dry-node convention as fillMesh, so contours stay inside the
// wetted/valid result area.
export function strokeContours(ctx, sx, sy, tris, values, {
  min = 0,
  max = 1,
  interval = 1,
  color = "rgba(17,24,39,0.85)",
  width = 1,
  alpha = 1,
  maxLevels = 160,
} = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  if ((max - min) / interval > maxLevels) interval = (max - min) / maxLevels;

  const valueEps = Math.max(Math.abs(max - min) * 1e-10, 1e-9);
  let segments = 0;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const va = values[a], vb = values[b], vc = values[c];
    if (va <= -900 || vb <= -900 || vc <= -900) continue;

    const lo = Math.max(Math.min(va, vb, vc), min);
    const hi = Math.min(Math.max(va, vb, vc), max);
    if (hi < lo) continue;

    const k0 = Math.ceil((lo - min) / interval - 1e-9);
    const k1 = Math.floor((hi - min) / interval + 1e-9);
    for (let k = k0; k <= k1; k++) {
      const level = min + k * interval;
      const pts = [];
      addContourPoint(pts, sx[a], sy[a], sx[b], sy[b], va, vb, level, valueEps);
      addContourPoint(pts, sx[b], sy[b], sx[c], sy[c], vb, vc, level, valueEps);
      addContourPoint(pts, sx[c], sy[c], sx[a], sy[a], vc, va, level, valueEps);
      if (pts.length < 2) continue;
      const [p0, p1] = pts.length === 2 ? pts : farthestPair(pts);
      const dx = p0[0] - p1[0], dy = p0[1] - p1[1];
      if (dx * dx + dy * dy < 0.01) continue;
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      segments++;
    }
  }

  ctx.stroke();
  ctx.restore();
  return segments;
}

// Count wetted (paintable) triangles — for tests / sanity.
export function wetTriangleCount(tris, values) {
  let n = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (values[a] > -900 && values[b] > -900 && values[c] > -900) n++;
  }
  return n;
}

// Stroke the mesh triangulation (wireframe) for "Mesh elements" figures.
export function strokeMesh(ctx, sx, sy, tris, { color = "rgba(28,82,140,0.75)", width = 0.5 } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[c], sy[c]); ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}
