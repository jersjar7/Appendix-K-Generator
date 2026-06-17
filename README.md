# Appendix K Generator

A browser-only tool that turns **SRH-2D result exports** (from SMS) into clean
**Appendix K plan-view figures** — shear stress, velocity, water depth, and water
surface elevation contoured over a faint Esri aerial basemap — replacing the
manual SMS → screenshot → Word → Bluebeam workflow.

Sibling to the **Appendix H Generator** (cross-section charts). Same philosophy:
**static, client-side, zero-install**, data never leaves the browser.

## Why a web app (decided 2026-06-17)

A Python GUI was considered and rejected for the same reason Appendix H avoided a
compiled `.exe`: on locked-down corporate (Kiewit) machines, a PyInstaller `.exe`
is blocked by **SmartScreen + AppLocker/WDAC whitelisting + EDR/antivirus**, and
shipping raw `.py` needs a Python install users can't perform. "Run anyway" is not
reliably available under managed policy. A static web app sidesteps all of it:
just a URL, no install, deploys on GitHub Pages or a Kiewit host.

Everything the tool needs runs client-side, so this is feasible:

| Step | Library |
|---|---|
| Read the XMDF `.h5` files (geometry + datasets) | `h5wasm` (HDF5 → WebAssembly) |
| Reproject the custom WA State Plane "ground" CRS (from WKT) | `proj4js` |
| Mesh contours from the true connectivity | canvas/WebGL (no Delaunay needed) |
| Esri aerial basemap (USGS NAIP fallback) | Leaflet/MapLibre XYZ tiles |
| Export PNG + Word | canvas→PNG + the dependency-free `.docx` builder from Appendix H |

## Input contract (LOCKED 2026-06-17)

The user drops, **per mesh (Existing, Proposed), two XMDF `.h5` files** — the
shapefile route was dropped because SMS truncates its column names to 10 chars
and mangles run identity. The two `.h5` halves snap together by node index:

| File (SMS export) | Contains | Lacks |
|---|---|---|
| **Mesh geometry `.h5`** ("Mesh as h5") | `2DMeshModule/<name>_Mesh/Nodes/NodeLocs` (14320×3 X/Y/Z), `Elements/Nodeids` (23292×4 connectivity), **CRS as a `WKT` attr** on `…/Coordinates` | values, run names |
| **All-datasets `.h5`** ("export all datasets of a mesh") | `Datasets/<EX 2-year (SRH-2D)>/<B_Stress_lb_p_ft2\|Vel_Mag_ft_p_s\|Velocity_ft_p_s (14320×2 vector)\|Water_Depth_ft\|Water_Elev_ft\|Froude>/Values` (T×14320), clean SMS names, `Z` | geometry, CRS |

- Node order is identical across geometry, datasets, and the old shapefile
  (verified: 0.0000 ft coord diff; `EXMesh` "EX 2-year" shear == standalone
  2-year `.h5`). So `Values[:,i]` ↔ `NodeLocs[i]` with no matching needed.
- CRS (from the geometry `.h5` WKT, == the shapefile `.prj`): NAD83(HARN) WA
  State Plane North, **US Survey Feet, custom "ground" CRS** (`CF≈0.99996`,
  false_easting 1968572.96). Self-describing → reproject via the WKT; do NOT
  substitute stock EPSG:2285.
- Open: confirm whether SMS can bundle geometry + datasets into **one** `.h5`
  per mesh (→ 1 file/mesh instead of 2).

App responsibilities: auto-detect geometry vs datasets file (`NodeLocs` vs
`Datasets/`), pair EX↔EX / PR↔PR by mesh name, title figures from the clean SMS
dataset names, take the final timestep, draw flow arrows from the velocity
vector. **No user naming convention required** beyond sensible SMS dataset names.

## Rendering notes (from the proof-of-concept)

- Use the **final/converged timestep**; clamp the legend (e.g. 0–8 for shear) so a
  mid-run transient (a 12.98 spike was seen at an intermediate step) doesn't blow
  the color scale.
- Mask non-wet nodes (sentinel `-999` / active flag) and spurious long Delaunay
  triangles (edge length threshold) so only the wetted channel is colored.
- Match the reviewer look: FHWA-style ramp, blocky/discrete bands at a specified
  interval (0.5 or 1), legend with units, north arrow, scale bar (US Survey Feet),
  station labels (PR 10+00…), flow arrows from `VEL_MAG` x/y components.

## Open items before/while building

- **Run naming: SOLVED** by the `.h5` contract — clean SMS dataset names come
  straight from the all-datasets file. No column→run key, no user convention.
- **One-file-per-mesh?** Confirm whether SMS can bundle geometry + datasets into
  a single `.h5` (would halve the upload count).
- **Esri basemap licensing/attribution** — Kiewit licenses Esri (OK); USGS NAIP
  is the no-license fallback. Only the map extent is sent to the tile server;
  result values stay local.
- Confirm the exact FHWA color breakpoints reviewers expect per parameter.

## Status

**Basic version working.** Drop the two `.h5` files → pick run + parameter +
basemap → Generate a georeferenced figure (contours over a faint Esri/USGS
aerial, FHWA-style legend, title, north arrow, scale bar) → Download PNG. Fully
client-side; libraries vendored (no CDN). Verified end-to-end with Playwright on
the real Existing exports (2-year / 100-year shear, velocity).

Implemented: `js/{h5,geo,ramps,contour,render,tiles}.js`, `js/app.js`,
`index.html`, `css/styles.css`. Tests: `test/read.mjs` (node, 9/9).

Next (deferred — "customization comes later"): exact FHWA ramp RGBs; per-figure
range/interval/legend tuning; flow arrows from the velocity vector; station
labels; batch export of all runs×params; Word/PDF assembly; multi-mesh
(Existing + Proposed) in one session; committed Playwright UI test + deploy.
