// Validate the full data pipeline against the real exports, rendering one figure
// (EX 2-year shear, final timestep) from the TWO .h5 files with node-canvas.
import * as hdf5 from "h5wasm/node";
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "canvas";
import { readGeometry, readDatasets, finalTimestep, isGeometryFile, isDatasetsFile } from "../js/h5.js";
import { toLonLat, lonLatToMerc } from "../js/geo.js";
import { makeColorFn } from "../js/ramps.js";
import { fitToScreen, fillMesh, wetTriangleCount } from "../js/contour.js";

const U = "/Users/jerson/.claude/uploads/1f5c7f3b-f9ec-4fa0-beec-52daf72dc626/";
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.error("  ✗", m)));

await hdf5.ready;
hdf5.FS.writeFile("geom.h5", readFileSync(U + "9e69aea5-Mesh_as_h5.h5"));
hdf5.FS.writeFile("data.h5", readFileSync(U + "7629eb53-EXMesh.h5"));
const gFile = new hdf5.File("geom.h5", "r");
const dFile = new hdf5.File("data.h5", "r");

ok(isGeometryFile(gFile), "geometry file detected");
ok(isDatasetsFile(dFile), "datasets file detected");
ok(!isGeometryFile(dFile) && !isDatasetsFile(gFile), "files not mis-detected as each other");

const geom = readGeometry(gFile);
ok(geom.N === 14320, `14320 nodes (got ${geom.N})`);
ok(geom.tris.length / 3 > 20000, `triangulated mesh (${geom.tris.length / 3} tris)`);
ok(/Lambert_Conformal_Conic/.test(geom.wkt), "CRS WKT carried from geometry file");

const { runs } = readDatasets(dFile);
const names = runs.map((r) => r.name);
ok(names.includes("EX 2-year (SRH-2D)") && names.includes("EX 500-year (SRH-2D)"),
   `clean run names: ${names.join(", ")}`);

// reproject → land in Washington (Hood Canal)
const { lon, lat } = toLonLat(geom.xy, geom.wkt);
ok(lon[0] > -123.5 && lon[0] < -122 && lat[0] > 47 && lat[0] < 48.5,
   `reprojects into WA (lon ${lon[0].toFixed(3)}, lat ${lat[0].toFixed(3)})`);

// EX 2-year shear, final timestep
const shear = finalTimestep(dFile, "EX 2-year (SRH-2D)", "B_Stress_lb_p_ft2");
const wet = wetTriangleCount(geom.tris, shear);
ok(wet > 1000, `wetted triangles present (${wet})`);

// render over web-mercator coords (what the browser will use under tiles)
const { mx, my } = lonLatToMerc(lon, lat);
const W = 1200, H = 700;
const cv = createCanvas(W, H), ctx = cv.getContext("2d");
ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
const { sx, sy } = fitToScreen(mx, my, W, H, 40);
fillMesh(ctx, sx, sy, geom.tris, shear, makeColorFn("B_Stress_lb_p_ft2", { min: 0, max: 8 }));
writeFileSync("/tmp/k_shear_from_h5.png", cv.toBuffer("image/png"));
console.log("  → wrote /tmp/k_shear_from_h5.png");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
