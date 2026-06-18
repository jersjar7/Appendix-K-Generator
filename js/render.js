// Figure overlays: title, legend, north arrow, scale bar. Each is upright and
// placeable via an 8-way anchor + X/Y nudge, with a subtle panel so it reads
// over imagery. Environment-agnostic (browser or node canvas).

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v % 1) < 1e-9 ? v.toFixed(0) : v.toFixed(1));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Top-left of a w×h box, anchored in the frame (8 positions) + nudge.
export function anchorBox(anchor, w, h, frameW, frameH, M, offX = 0, offY = 0) {
  const ax = { l: M, c: (frameW - w) / 2, r: frameW - w - M };
  const ay = { t: M, m: (frameH - h) / 2, b: frameH - h - M };
  let x, y;
  if (anchor === "ml") { x = M; y = ay.m; }
  else if (anchor === "mr") { x = ax.r; y = ay.m; }
  else { x = ax[anchor[1]]; y = ay[anchor[0]]; }
  return [x + offX, y + offY];
}
const M = 18;

export function drawTitle(ctx, text, o) {
  const { frameW, frameH, anchor = "tc", offX = 0, offY = 0, fontSize = 24 } = o;
  ctx.save();
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + 28, h = fontSize + 18;
  const [x, y] = anchorBox(anchor, w, h, frameW, frameH, M, offX, offY);
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.strokeStyle = "rgba(0,0,0,0.2)";
  roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
}

// Colorbar legend: continuous stacked bar (lowest at bottom), one number per
// boundary. `legend` = {bands:[{color}], lo, hi, label, units}.
export function drawLegend(ctx, legend, o) {
  const { frameW, frameH, anchor = "tl", offX = 0, offY = 0, fontSize = 20 } = o;
  const n = legend.bands.length;
  const sw = Math.round(fontSize * 1.9);
  const blockH = Math.max(fontSize + 6, 20);
  const barH = n * blockH, titleH = fontSize + 14, pad = 12, gap = 8;

  const labels = [];
  for (let i = 0; i <= n; i++) labels.push(fmt(legend.lo + (i * (legend.hi - legend.lo)) / n));
  const title = `${legend.label}${legend.units ? " (" + legend.units + ")" : ""}`;

  ctx.save();
  ctx.font = `bold ${fontSize + 2}px Arial, sans-serif`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `${fontSize}px Arial, sans-serif`;
  let maxLabelW = 0;
  for (const l of labels) maxLabelW = Math.max(maxLabelW, ctx.measureText(l).width);

  const w = Math.max(pad + sw + gap + 6 + maxLabelW + pad, pad + titleW + pad);
  const h = pad + titleH + barH + pad + fontSize / 2;
  const [px, py] = anchorBox(anchor, w, h, frameW, frameH, M, offX, offY);

  ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.strokeStyle = "rgba(0,0,0,0.22)";
  roundRect(ctx, px, py, w, h, 8); ctx.fill(); ctx.stroke();

  ctx.fillStyle = "#111"; ctx.font = `bold ${fontSize + 2}px Arial, sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(title, px + pad, py + pad);

  const barX = px + pad, barTop = py + pad + titleH, barBottom = barTop + barH;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = legend.bands[i].color;
    ctx.fillRect(barX, barBottom - (i + 1) * blockH, sw, blockH);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barTop + 0.5, sw, barH);

  ctx.fillStyle = "#111"; ctx.font = `${fontSize}px Arial, sans-serif`; ctx.textBaseline = "middle";
  for (let i = 0; i <= n; i++) {
    const y = barBottom - i * blockH;
    ctx.beginPath(); ctx.moveTo(barX + sw, y); ctx.lineTo(barX + sw + 5, y); ctx.stroke();
    ctx.fillText(labels[i], barX + sw + gap, y);
  }
  ctx.restore();
}

// North arrow in a CIRCLE. The needle + N are centered and rotate by rotRad, so
// they stay inside the circle at any orientation.
export function drawNorthArrow(ctx, o) {
  const { frameW, frameH, anchor = "br", offX = 0, offY = 0, radius = 46, rotRad = 0 } = o;
  const d = radius * 2;
  const [x, y] = anchorBox(anchor, d, d, frameW, frameH, M, offX, offY);
  const cx = x + radius, cy = y + radius;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 1.5; ctx.stroke();

  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  // glyph (N + needle) is laid out symmetric about y=0 — its long axis spans
  // [-A, +A], so it rotates about its own middle and stays clear of the rim.
  const r = radius, A = 0.84 * r, fN = Math.round(r * 0.4);
  ctx.fillStyle = "#111";
  ctx.beginPath();                                   // needle points north (up)
  ctx.moveTo(0, -0.28 * r);                          // tip (just below the N)
  ctx.lineTo(0.27 * r, A);                           // base right
  ctx.lineTo(0, 0.42 * r);                           // notch
  ctx.lineTo(-0.27 * r, A);                          // base left
  ctx.closePath(); ctx.fill();
  ctx.font = `bold ${fN}px Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("N", 0, -A + fN / 2);                 // N at the top of the axis
  ctx.restore();
}

// Scale bar in feet. `sizeScale` enlarges the bar + text together.
export function drawScaleBar(ctx, o) {
  const { frameW, frameH, anchor = "bl", offX = 0, offY = 0, ftPerPixel, sizeScale = 1.4 } = o;
  const targetPx = 140 * sizeScale;
  const targetFt = targetPx * ftPerPixel;
  const pow = Math.pow(10, Math.floor(Math.log10(targetFt)));
  const niceFt = [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - targetFt) < Math.abs(a - targetFt) ? b : a));
  const barPx = niceFt / ftPerPixel;
  const font = Math.round(13 * sizeScale), pad = 12 * sizeScale, tick = 6 * sizeScale;

  const w = barPx + pad * 2, h = font + tick + 22 * sizeScale;
  const [x, y] = anchorBox(anchor, w, h, frameW, frameH, M, offX, offY);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.strokeStyle = "rgba(0,0,0,0.22)";
  roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
  const bx = x + pad, by = y + h - pad;
  ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = Math.max(2, sizeScale * 1.6);
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
  ctx.moveTo(bx, by - tick); ctx.lineTo(bx, by + tick);
  ctx.moveTo(bx + barPx, by - tick); ctx.lineTo(bx + barPx, by + tick);
  ctx.stroke();
  ctx.font = `${font}px Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(`${niceFt.toLocaleString()} ft (U.S. Survey)`, bx + barPx / 2, by - tick - 2);
  ctx.restore();
}
