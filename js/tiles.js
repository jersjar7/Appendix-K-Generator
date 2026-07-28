// Esri / USGS XYZ imagery basemap, drawn into the rotated, full-bleed view so it
// aligns with the contours. Browser-only (fetches tiles). Fails gracefully — if
// a tile can't load the figure still renders without the aerial.

const R = 6378137, C = 2 * Math.PI * R;
const TILE_SIZE = 256;
const MAX_TILE_COUNT = 400;
const TILE_CACHE_LIMIT = 256;
export const ESRI_WORLD_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_WORLD_IMAGERY_ALTERNATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const USGS_IMAGERY =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
const tileBlobCache = new Map();

const mercToGlobal = (mx, my, worldPx) => [
  (mx + Math.PI * R) / C * worldPx,
  (Math.PI * R - my) / C * worldPx,
];
const globalToMerc = (gx, gy, worldPx) => [
  gx / worldPx * C - Math.PI * R,
  Math.PI * R - gy / worldPx * C,
];

// Draws the aerial covering the whole (rotated) frame. The caller does NOT need
// to set up the rotation — this manages its own save/translate/rotate.
export async function drawBasemap(ctx, view, { url = ESRI_WORLD_IMAGERY } = {}) {
  // cap zoom at 19 — Esri/USGS imagery thins out past that in rural areas and
  // serves gray "no data" placeholders; capped tiles upscale but always cover.
  const z = Math.max(2, Math.min(19, Math.round(Math.log2(view.scale * C / TILE_SIZE))));
  const worldPx = TILE_SIZE * 2 ** z;
  const bb = view.coverBbox();
  const [gx0, gy1] = mercToGlobal(bb.x0, bb.y0, worldPx); // sw → (small gx, large gy)
  const [gx1, gy0] = mercToGlobal(bb.x1, bb.y1, worldPx); // ne → (large gx, small gy)
  const tx0 = Math.floor(gx0 / TILE_SIZE), tx1 = Math.floor(gx1 / TILE_SIZE);
  const ty0 = Math.floor(gy0 / TILE_SIZE), ty1 = Math.floor(gy1 / TILE_SIZE);
  // guardrail against pathological tile counts
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILE_COUNT) return;

  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++)
      jobs.push(loadTile(url, z, tx, ty, worldPx, view));
  const tiles = (await Promise.all(jobs)).filter(Boolean);

  // Keep the canvas transform entirely synchronous. This prevents an older,
  // slower render from interleaving its save/restore stack with a newer render.
  ctx.save();
  ctx.translate(view.originX, view.originY);
  ctx.rotate(view.rotRad);
  for (const tile of tiles) {
    ctx.drawImage(tile.bitmap, tile.lx, tile.ly, tile.lw, tile.lh);
    tile.bitmap.close?.();
  }
  ctx.restore();
}

function tileUrl(template, z, tx, ty) {
  return template.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
}

function cachedTileBlob(url) {
  const cached = tileBlobCache.get(url);
  if (cached) return cached;
  const request = fetch(url, { mode: "cors" })
    .then((res) => res.ok ? res.blob() : null)
    .catch(() => null)
    .then((blob) => {
      if (!blob) tileBlobCache.delete(url);
      return blob;
    });
  tileBlobCache.set(url, request);
  if (tileBlobCache.size > TILE_CACHE_LIMIT) {
    tileBlobCache.delete(tileBlobCache.keys().next().value);
  }
  return request;
}

function tileProviders(primary) {
  if (primary !== ESRI_WORLD_IMAGERY) return [primary];
  return [primary, ESRI_WORLD_IMAGERY_ALTERNATE, USGS_IMAGERY];
}

async function loadTile(url, z, tx, ty, worldPx, view) {
  try {
    let blob = null;
    for (const provider of tileProviders(url)) {
      blob = await cachedTileBlob(tileUrl(provider, z, tx, ty));
      if (blob) break;
    }
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const [mx0, my1] = globalToMerc(tx * TILE_SIZE, ty * TILE_SIZE, worldPx);       // tile NW corner
    const [mx1, my0] = globalToMerc((tx + 1) * TILE_SIZE, (ty + 1) * TILE_SIZE, worldPx); // tile SE corner
    const [lx, ly] = view.toLocal(mx0, my1);
    const lw = view.scale * (mx1 - mx0), lh = view.scale * (my1 - my0);
    return { bitmap, lx, ly, lw, lh };
  } catch {
    return null;
  }
}
