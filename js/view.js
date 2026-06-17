// View transform for a framed, full-bleed, rotatable map figure.
//
// Content (basemap + contours) is drawn inside a rotated context:
//   ctx.translate(w/2, h/2); ctx.rotate(rotRad);  then draw at LOCAL coords.
// `toLocal(mx,my)` maps Web-Mercator → those local coords (y flipped, merc up =
// screen up before rotation). Overlays (legend/scale/north) are drawn after
// restore() in plain screen space; only the north glyph rotates by rotRad.

const R = 6378137, C = 2 * Math.PI * R;

export const FRAMES = {
  landscape: { w: 1650, h: 1275 }, // 11 × 8.5 in @ 150 ppi
  portrait:  { w: 1275, h: 1650 }, // 8.5 × 11 in @ 150 ppi
};

// data: merc bbox {x0,x1,y0,y1}. Returns a view object.
export function makeView(data, { w, h, rotDeg = 0, marginFrac = 0.9 }) {
  const cx = (data.x0 + data.x1) / 2, cy = (data.y0 + data.y1) / 2;
  const dx = data.x1 - data.x0 || 1, dy = data.y1 - data.y0 || 1;
  const scale = Math.min((w * marginFrac) / dx, (h * marginFrac) / dy);
  const rotRad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);

  const toLocal = (mx, my) => [scale * (mx - cx), -scale * (my - cy)];

  // screen pixel (sx,sy) → merc, for working out which tiles cover the frame
  const screenToMerc = (sx, sy) => {
    const px = sx - w / 2, py = sy - h / 2;        // relative to center
    const lx = px * cos + py * sin;                 // un-rotate (Rot(-θ))
    const ly = -px * sin + py * cos;
    return { x: cx + lx / scale, y: cy - ly / scale };
  };

  // merc bbox covering the four frame corners (rotation-aware)
  const coverBbox = () => {
    const pts = [screenToMerc(0, 0), screenToMerc(w, 0), screenToMerc(w, h), screenToMerc(0, h)];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return { x0, x1, y0, y1 };
  };

  return { w, h, cx, cy, scale, rotRad, toLocal, coverBbox, mercConst: { R, C } };
}

// ground feet per screen pixel (for the scale bar), accounting for mercator
// distortion at this latitude. latRad = mean data latitude in radians.
export function ftPerPixel(view, latRad) {
  return (1 / view.scale) * Math.cos(latRad) / 0.3048;
}
