import assert from "node:assert/strict";
import {
  formatStation,
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

assert.equal(formatStation(0), "0+00");
assert.equal(formatStation(1070), "10+70");
assert.equal(formatStation(1100), "11+00");
assert.equal(formatStation(99.6), "1+00");

console.log("Overlay stationing tests passed.");
