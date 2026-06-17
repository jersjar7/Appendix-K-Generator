// Figure furniture drawn onto a 2D context: legend, north arrow, scale bar, title.
// Environment-agnostic (browser canvas or node-canvas).

export function drawTitle(ctx, text, w, y = 30) {
  ctx.save();
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  roundRect(ctx, w / 2 - tw / 2 - 14, y - 18, tw + 28, 36, 8);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.fillText(text, w / 2, y);
  ctx.restore();
}

// Colorbar legend: a continuous stacked bar (lowest value at the bottom) with a
// single number at every color boundary. `legend` = {bands:[{from,to,color}],
// lo, hi, label, units}. Placement: anchor (tl/tc/tr/ml/mr/bl/bc/br) + X/Y nudge.
export function drawLegend(ctx, legend, opts = {}) {
  const { frameW, frameH, anchor = "tl", offX = 0, offY = 0, fontSize = 16 } = opts;
  const n = legend.bands.length;
  const sw = 30;                          // colorbar width
  const blockH = Math.max(fontSize + 6, 20);
  const barH = n * blockH;
  const titleH = fontSize + 12;
  const pad = 10, gap = 8;

  const labels = [];
  for (let i = 0; i <= n; i++) labels.push(fmt(legend.lo + (i * (legend.hi - legend.lo)) / n));
  const title = `${legend.label}${legend.units ? " (" + legend.units + ")" : ""}`;

  ctx.save();
  ctx.font = `bold ${fontSize + 1}px Arial, sans-serif`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `${fontSize}px Arial, sans-serif`;
  let maxLabelW = 0;
  for (const l of labels) maxLabelW = Math.max(maxLabelW, ctx.measureText(l).width);

  const panelW = Math.max(pad + sw + gap + maxLabelW + pad, pad + titleW + pad);
  const panelH = pad + titleH + barH + pad + fontSize / 2;

  // anchor → panel top-left within the frame, then apply the nudge
  const M = 18;
  const ax = { l: M, c: (frameW - panelW) / 2, r: frameW - panelW - M };
  const ay = { t: M, m: (frameH - panelH) / 2, b: frameH - panelH - M };
  const hx = anchor[1] === "c" ? "c" : anchor[1]; // tc/bc → center; ml/mr handled below
  let px, py;
  if (anchor === "ml") { px = M; py = ay.m; }
  else if (anchor === "mr") { px = ax.r; py = ay.m; }
  else { px = ax[anchor[1]]; py = ay[anchor[0]]; }
  px += offX; py += offY;

  // panel
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  roundRect(ctx, px, py, panelW, panelH, 7);
  ctx.fill(); ctx.stroke();

  // title
  ctx.fillStyle = "#111";
  ctx.font = `bold ${fontSize + 1}px Arial, sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(title, px + pad, py + pad);

  // colorbar (lowest band at the bottom)
  const barX = px + pad, barTop = py + pad + titleH, barBottom = barTop + barH;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = legend.bands[i].color;
    ctx.fillRect(barX, barBottom - (i + 1) * blockH, sw, blockH);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barTop + 0.5, sw, barH);

  // one number per boundary, aligned to the boundary line
  ctx.fillStyle = "#111";
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  for (let i = 0; i <= n; i++) {
    const y = barBottom - i * blockH;
    ctx.beginPath(); ctx.moveTo(barX + sw, y); ctx.lineTo(barX + sw + 4, y); ctx.stroke();
    ctx.fillText(labels[i], barX + sw + gap, y);
  }
  ctx.restore();
}
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

// North arrow overlay. The glyph rotates by `rotRad` (the map's rotation) so it
// keeps pointing true north; the panel stays put in the corner.
export function drawNorthArrow(ctx, cx, cy, rotRad = 0, size = 30) {
  ctx.save();
  // subtle panel
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  roundRect(ctx, cx - 26, cy - size - 16, 52, size * 1.7 + 22, 8);
  ctx.fill(); ctx.stroke();
  // rotated glyph
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * 0.3, size * 0.5); ctx.lineTo(0, size * 0.2);
  ctx.lineTo(-size * 0.3, size * 0.5); ctx.closePath();
  ctx.fill();
  ctx.font = "bold 14px Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -size - 1);
  ctx.restore();
}

// Scale bar in feet (overlay with a subtle panel). `ftPerPixel` = ground feet/px.
export function drawScaleBar(ctx, x, y, ftPerPixel) {
  const target = 120 * ftPerPixel;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const px = nice / ftPerPixel;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  roundRect(ctx, x - 10, y - 24, px + 20, 38, 6);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.font = "12px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(`${nice.toLocaleString()} ft (U.S. Survey)`, x + px / 2, y - 6);
  ctx.restore();
}
