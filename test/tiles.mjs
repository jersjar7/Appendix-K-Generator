import assert from "node:assert/strict";
import { drawBasemap } from "../js/tiles.js";

const originalFetch = globalThis.fetch;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const requests = [];
const operations = [];

globalThis.fetch = async (url) => {
  requests.push(String(url));
  return {
    ok: true,
    async blob() {
      return new Blob(["tile"]);
    },
  };
};
globalThis.createImageBitmap = async () => ({
  close() {},
});

const context = {
  save() { operations.push("save"); },
  translate() { operations.push("translate"); },
  rotate() { operations.push("rotate"); },
  drawImage() { operations.push("draw"); },
  restore() { operations.push("restore"); },
};
const view = {
  scale: 1,
  originX: 100,
  originY: 100,
  rotRad: 0,
  coverBbox() {
    return { x0: -400, x1: 400, y0: -400, y1: 400 };
  },
  toLocal(mx, my) {
    return [mx, my];
  },
};

try {
  await drawBasemap(context, view, {
    url: "https://tiles.example.test/{z}/{y}/{x}",
  });

  assert.ok(requests.length > 0, "expected tile requests");
  const zoomLevels = new Set(
    requests.map((url) => new URL(url).pathname.split("/")[1]),
  );
  assert.equal(zoomLevels.size, 1, "every request must use one zoom level");
  assert.equal(
    operations.filter((operation) => operation === "draw").length,
    requests.length,
    "every loaded tile must be painted exactly once",
  );
  assert.deepEqual(
    operations.slice(0, 3),
    ["save", "translate", "rotate"],
    "the canvas transform starts only after tile loading",
  );
  assert.equal(operations.at(-1), "restore");
  console.log("Uniform basemap tile tests passed.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.createImageBitmap = originalCreateImageBitmap;
}
