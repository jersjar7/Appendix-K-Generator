// Esri World Imagery (XYZ) basemap, drawn into the same pixel transform the
// contours use (from contour.fitToScreen on Web-Mercator coords). Browser-only
// (fetches tiles). Fails gracefully — if a tile can't load, the figure still
// renders without the aerial.

const R = 6378137, C = 2 * Math.PI * R;
// {z}/{y}/{x} order for ArcGIS tile services.
export const ESRI_WORLD_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// USGS NAIP imagery — license-free US fallback.
export const USGS_IMAGERY =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";

const mercToGlobal = (m, worldPx) => ({
  gx: (m.x + Math.PI * R) / C * worldPx,
  gy: (Math.PI * R - m.y) / C * worldPx,
});
const globalToMerc = (gx, gy, worldPx) => ({
  x: gx / worldPx * C - Math.PI * R,
  y: Math.PI * R - gy / worldPx * C,
});

// fit: {x0,y0,s,ox,oy,w,h} from contour.fitToScreen (merc → screen).
function screenFn(fit) {
  return (mx, my) => [fit.ox + fit.s * (mx - fit.x0), fit.h - (fit.oy + fit.s * (my - fit.y0))];
}

export async function drawBasemap(ctx, fit, { url = ESRI_WORLD_IMAGERY, fade = 0.45 } = {}) {
  const toScreen = screenFn(fit);
  // pick a zoom so tiles render close to 1:1 (256 px) under the current scale
  const z = Math.max(2, Math.min(21, Math.round(Math.log2(fit.s * C / 256))));
  const worldPx = 256 * 2 ** z;

  // data merc bbox → tile index range
  const a = mercToGlobal({ x: fit.x0, y: fit.y0 }, worldPx);
  const b = mercToGlobal({ x: fit.x1, y: fit.y1 }, worldPx);
  const tx0 = Math.floor(Math.min(a.gx, b.gx) / 256), tx1 = Math.floor(Math.max(a.gx, b.gx) / 256);
  const ty0 = Math.floor(Math.min(a.gy, b.gy) / 256), ty1 = Math.floor(Math.max(a.gy, b.gy) / 256);

  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(drawTile(ctx, url, z, tx, ty, worldPx, toScreen));
    }
  }
  await Promise.all(jobs);

  // fade the aerial so the contours read on top
  if (fade > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${fade})`;
    ctx.fillRect(0, 0, fit.w, fit.h);
    ctx.restore();
  }
}

async function drawTile(ctx, url, z, tx, ty, worldPx, toScreen) {
  try {
    const u = url.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
    const res = await fetch(u, { mode: "cors" });
    if (!res.ok) return;
    const bmp = await createImageBitmap(await res.blob());
    // tile global-px corners → merc → screen
    const tl = globalToMerc(tx * 256, ty * 256, worldPx);
    const br = globalToMerc((tx + 1) * 256, (ty + 1) * 256, worldPx);
    const [x0, y0] = toScreen(tl.x, tl.y); // top-left
    const [x1, y1] = toScreen(br.x, br.y); // bottom-right
    ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0);
    bmp.close?.();
  } catch { /* offline / blocked tile — skip, keep rendering */ }
}
