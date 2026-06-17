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
