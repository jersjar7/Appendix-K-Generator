import assert from "node:assert/strict";
import {
  conditionKey,
  conditionLabel,
  eventLabel,
  runLabel,
} from "../js/conditions.js";

assert.equal(conditionKey("Existing Mesh", "EX-Geo.h5"), "EX");
assert.equal(conditionKey("Nat_Mesh", "Na-geo.h5"), "NA");
assert.equal(conditionKey("", "Natural Geometry.h5"), "NA");
assert.equal(conditionKey("", "Natural Datasets.h5"), "NA");
assert.equal(conditionKey("Natural Conditions Mesh", "geometry.h5"), "NA");
assert.equal(conditionKey("FHD Mesh", "PR-Geo.h5"), "PR");
assert.equal(conditionKey("Mesh", "geometry.h5"), "DEFAULT");
assert.equal(conditionKey("Natural Mesh", "EX-Geo.h5"), "EX");

assert.equal(conditionLabel("NA"), "Natural");
assert.equal(runLabel("Nat_100YR (SRH-2D)"), "Natural_100YR");
assert.equal(eventLabel("Nat_2080 100YR (SRH-2D)"), "2080 100YR");

console.log("Condition detection tests passed.");
