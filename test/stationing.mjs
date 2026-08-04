import assert from "node:assert/strict";
import {
  drawOverlayStationLabels,
  formatStation,
  hitTestStationLabel,
  stationLabelKey,
  stationTicksForGeojson,
} from "../js/overlays.js";

const line = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [[0, 0], [0.001, 0]],
    },
  }],
};

const forward = stationTicksForGeojson(line, {
  stationStart: 1070,
  stationTickInterval: 25,
  stationLabelInterval: 100,
  stationDirection: "forward",
});
assert.equal(forward[0].station, 1075);
assert.deepEqual(
  forward.filter((tick) => tick.major).map((tick) => tick.station),
  [1100, 1200, 1300, 1400],
);
assert.ok(forward[0].coordinate[0] < forward.at(-1).coordinate[0]);

const reverse = stationTicksForGeojson(line, {
  stationStart: 1070,
  stationTickInterval: 25,
  stationLabelInterval: 100,
  stationDirection: "reverse",
});
assert.ok(reverse[0].coordinate[0] > reverse.at(-1).coordinate[0]);

const defaultInterval = stationTicksForGeojson(line);
assert.equal(defaultInterval[1].station - defaultInterval[0].station, 25);

assert.equal(formatStation(0), "0+00");
assert.equal(formatStation(1070), "10+70");
assert.equal(formatStation(1100), "11+00");
assert.equal(formatStation(99.6), "1+00");

function labelDrawCounts(stationLabelHalo) {
  const counts = { fill: 0, stroke: 0 };
  const ctx = {
    save() {},
    restore() {},
    fillText() { counts.fill++; },
    strokeText() { counts.stroke++; },
  };
  const view = {
    rotRad: 0,
    originX: 0,
    originY: 0,
    toLocal(x, y) { return [x, y]; },
  };
  drawOverlayStationLabels(ctx, [{
    geojson: line,
    color: "#e8112d",
    stationing: true,
    stationLabelHalo,
    stationTickInterval: 100,
    stationLabelInterval: 100,
  }], view);
  return counts;
}

const haloOn = labelDrawCounts(true);
assert.ok(haloOn.fill > 0);
assert.equal(haloOn.stroke, haloOn.fill);

const haloOff = labelDrawCounts(false);
assert.equal(haloOff.fill, haloOn.fill);
assert.equal(haloOff.stroke, 0);

function labelLayouts(options = {}) {
  const ctx = {
    save() {},
    restore() {},
    fillText() {},
    strokeText() {},
    measureText(text) { return { width: text.length * 10 }; },
  };
  const view = {
    rotRad: 0,
    originX: 0,
    originY: 0,
    toLocal(x, y) { return [x, y]; },
  };
  return drawOverlayStationLabels(ctx, [{
    geojson: line,
    color: "#e8112d",
    stationing: true,
    stationTickInterval: 25,
    stationLabelInterval: 100,
    stationTickLength: 16,
    stationLabelSize: 18,
    stationLabelOffset: 10,
    stationLabelSide: "left",
    ...options,
  }], view);
}

const leftLabels = labelLayouts();
const fartherLabels = labelLayouts({ stationLabelOffset: 30 });
const rightLabels = labelLayouts({ stationLabelSide: "right" });
assert.ok(leftLabels.length > 0);
assert.ok(fartherLabels[0].y > leftLabels[0].y);
assert.equal(Math.round(fartherLabels[0].y - leftLabels[0].y), 20);
assert.ok(leftLabels[0].y > 0);
assert.ok(rightLabels[0].y < 0);

const firstKey = stationLabelKey(leftLabels[0].station);
const adjustedLabels = labelLayouts({
  stationLabelOverrides: { [firstKey]: { along: 15, across: -7 } },
});
assert.equal(Math.round(adjustedLabels[0].x - leftLabels[0].x), 15);
assert.equal(Math.round(adjustedLabels[0].y - leftLabels[0].y), -7);
assert.equal(
  hitTestStationLabel([adjustedLabels[0]], adjustedLabels[0].x, adjustedLabels[0].y)?.stationKey,
  firstKey,
);
assert.equal(hitTestStationLabel(adjustedLabels, -1000, -1000), null);

console.log("Overlay stationing tests passed.");
