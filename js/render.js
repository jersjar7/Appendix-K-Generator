// Figure furniture drawn onto a 2D context: legend, north arrow, scale bar, title.
// Environment-agnostic (browser canvas or node-canvas).

export function drawTitle(ctx, text, w, y = 30) {
  ctx.save();
  ctx.fillStyle = "#111";
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, y);
  ctx.restore();
}

// Vertical legend of discrete bands. `legend` = {bands:[{from,to,color}], label, units}.
export function drawLegend(ctx, legend, x, y) {
  ctx.save();
  const sw = 26, sh = 16, font = 13;
  // background panel so the legend reads over aerial imagery
  const panelW = 150, panelH = 22 + legend.bands.length * sh + 8;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  roundRect(ctx, x - 8, y - 18, panelW, panelH, 6);
  ctx.fill(); ctx.stroke();
  ctx.font = `${font}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  // title
  ctx.fillStyle = "#111";
  ctx.font = `bold ${font}px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`${legend.label}${legend.units ? " (" + legend.units + ")" : ""}`, x, y);
  ctx.font = `${font}px Arial, sans-serif`;
  let yy = y + 16;
  // draw high→low so the legend reads top=high
  const bands = [...legend.bands].reverse();
  for (const b of bands) {
    ctx.fillStyle = b.color;
    ctx.fillRect(x, yy, sw, sh);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(x + 0.5, yy + 0.5, sw, sh);
    ctx.fillStyle = "#111";
    ctx.fillText(`${fmt(b.from)} – ${fmt(b.to)}`, x + sw + 8, yy + sh / 2);
    yy += sh;
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

export function drawNorthArrow(ctx, x, y, size = 34) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * 0.28, size * 0.5); ctx.lineTo(0, size * 0.18);
  ctx.lineTo(-size * 0.28, size * 0.5); ctx.closePath();
  ctx.fill();
  ctx.font = "bold 14px Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -size - 2);
  ctx.restore();
}

// Scale bar in feet. `ftPerPixel` = ground feet per screen pixel.
export function drawScaleBar(ctx, x, y, ftPerPixel) {
  // pick a "nice" round length close to ~120 px
  const target = 120 * ftPerPixel;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const px = nice / ftPerPixel;
  ctx.save();
  ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.font = "12px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(`${nice.toLocaleString()} ft (U.S. Survey)`, x + px / 2, y - 6);
  ctx.restore();
}
