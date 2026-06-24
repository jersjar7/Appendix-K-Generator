// Smoke test for Save/Load project: drop mesh, tweak, save, reload page, load, verify.
// Run: node test/project-smoke.mjs  (requires playwright + a static server on :8137)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".h5": "application/octet-stream" };
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(8137, r));

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

try {
  await page.goto("http://localhost:8137/index.html");
  await page.waitForFunction(() => window.h5wasm || document.querySelector("#saveProject"));

  // Drop the two mesh .h5 files via the hidden file input.
  await page.setInputFiles("#files", [join(ROOT, "geom.h5"), join(ROOT, "data.h5")]);
  await page.waitForSelector("#actions:not([hidden])", { timeout: 20000 });
  await page.click("#generate");
  await page.waitForSelector("#figure:not([hidden])", { timeout: 20000 });
  const openGroups = () => page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await openGroups();

  // "Topography + mesh elements" combined figure: the option exists, selects, and
  // renders a non-blank canvas with the topography (not topo+mesh) legend label.
  const hasCombo = await page.locator("#param option").evaluateAll((os) => os.some((o) => o.value === "__topomesh__" && /Topography \+ mesh/i.test(o.textContent)));
  if (!hasCombo) fail("Topography + mesh elements option missing from #param");
  await page.selectOption("#param", "__topomesh__");
  await page.click("#generate");
  // generate() posts its "Generated …" message only after render() (incl. basemap) resolves.
  await page.waitForFunction(() => /Generated .*Topography \+ mesh/i.test(document.querySelector("#messages")?.textContent || ""), { timeout: 20000 });
  const comboNonBlank = await page.evaluate(() => {
    const c = document.querySelector("#figure");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const first = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4) if (d[i] !== first[0] || d[i + 1] !== first[1] || d[i + 2] !== first[2]) return true;
    return false;
  });
  if (!comboNonBlank) fail("Topography + mesh figure rendered blank");
  else console.log("topo+mesh combined figure OK");

  // Bulk-add labels from a comma-separated string — should create 3 cards in order.
  await page.fill("#bulkLabels", "BULK A, BULK B, BULK C");
  await page.click("#addBulkLabels");
  await page.waitForFunction(() => document.querySelectorAll(".anno-card").length === 3);
  const bulkTexts = await page.locator(".anno-card .anno-text").evaluateAll((els) => els.map((e) => e.value));
  if (bulkTexts.join("|") !== "BULK A|BULK B|BULK C") fail(`bulk labels wrong/disordered: ${bulkTexts.join("|")}`);
  if (await page.locator("#bulkLabels").inputValue() !== "") fail("bulk input not cleared after add");
  console.log("bulk-add OK:", bulkTexts.join(", "));

  // Make distinctive tweaks: add a label with custom text, rotate, set title text.
  await page.click("#addLabel");
  await page.fill(".anno-card .anno-text >> nth=0", "SMOKE-TEST-LABEL");
  await page.fill("#titleText", "My Custom Title");
  await page.fill("#legendFont", "33");
  await page.selectOption("#orientation", { index: 1 }).catch(() => {});

  // Save project — capture the download.
  const dl = await Promise.all([
    page.waitForEvent("download"),
    page.click("#saveProject"),
  ]).then(([d]) => d);
  const savedPath = await dl.path();
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  if (saved.app !== "appendix-k-generator") fail("saved file app id wrong");
  if (!saved.annotations?.some((a) => a.text === "SMOKE-TEST-LABEL")) fail("annotation not in saved file");
  if (saved.controls?.titleText !== "My Custom Title") fail("title not in saved file");
  if (saved.controls?.legendFont !== "33") fail("legendFont not in saved file");
  console.log("saved file OK:", saved.annotations.length, "annotations,", saved.overlays.length, "overlays");

  // Reload the page (fresh state) and load the project, then re-drop mesh.
  await page.reload();
  await page.waitForSelector("#loadProject");
  await openGroups();
  await page.setInputFiles("#projectFile", savedPath);
  // Project loaded with no data yet — annotation state is restored in the DOM even
  // though #customize is still hidden until a figure is generated.
  await page.waitForSelector(".anno-card .anno-text", { state: "attached", timeout: 5000 });
  const labelAfterLoad = await page.locator(".anno-card .anno-text").first().inputValue();
  if (labelAfterLoad !== "SMOKE-TEST-LABEL") fail(`label not restored before mesh: got "${labelAfterLoad}"`);
  const titleAfterLoad = await page.inputValue("#titleText");
  if (titleAfterLoad !== "My Custom Title") fail(`title not restored: got "${titleAfterLoad}"`);

  // Re-drop mesh — figure should auto-rebuild from the restored selection.
  await page.setInputFiles("#files", [join(ROOT, "geom.h5"), join(ROOT, "data.h5")]);
  await page.waitForSelector("#figure:not([hidden])", { timeout: 20000 });
  const legendFontAfter = await page.inputValue("#legendFont");
  if (legendFontAfter !== "33") fail(`legendFont not restored: got "${legendFontAfter}"`);

  if (errors.length) fail("console/page errors:\n" + errors.join("\n"));
  if (!process.exitCode) console.log("SMOKE TEST PASSED");
} catch (e) {
  fail("exception: " + (e.stack || e.message));
} finally {
  await browser.close();
  server.close();
}
