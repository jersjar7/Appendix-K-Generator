// FHWA-style color ramps, approximated (the exact SMS RGBs aren't published;
// these match the target figures and the SMS ramp picker closely enough for a
// first version, and are data-driven so exact values can be dropped in later).
//
// Each ramp is a list of [position 0..1, [r,g,b]] stops.

export const RAMPS = {
  // blue → cyan → green → yellow → red (shear, velocity, Froude, water surface)
  jet: [
    [0.0, [0, 0, 200]], [0.2, [0, 160, 235]], [0.4, [40, 200, 90]],
    [0.6, [235, 235, 40]], [0.8, [240, 140, 30]], [1.0, [210, 30, 30]],
  ],
  // pale → blue → deep blue (depth)
  depth: [
    [0.0, [222, 235, 247]], [0.35, [120, 180, 230]], [0.7, [40, 90, 200]], [1.0, [10, 25, 110]],
  ],
};

// Map a SMS parameter dataset name → display config.
const PARAM_DEFS = [
  { match: /B_?Stress/i,  key: "shear",    label: "Shear",          units: "lb/ft²",  ramp: "jet",   range: [0, 8],   interval: 0.5 },
  { match: /Vel_?Mag/i,   key: "velocity", label: "Velocity",       units: "ft/s",    ramp: "jet",   range: null,     interval: 0.5 },
  { match: /Water_?Depth/i, key: "depth",  label: "Water Depth",    units: "ft",      ramp: "depth", range: null,     interval: 0.5 },
  { match: /Water_?Elev/i, key: "wse",     label: "Water Surface",  units: "ft",      ramp: "jet",   range: null,     interval: 0.5 },
  { match: /Froude/i,     key: "froude",   label: "Froude",         units: "",        ramp: "jet",   range: [0, 1.5], interval: 0.1 },
];

export function paramDef(datasetName) {
  return PARAM_DEFS.find((d) => d.match.test(datasetName)) ||
    { key: "scalar", label: datasetName, units: "", ramp: "jet", range: null, interval: null };
}

// Interpolate a ramp at t∈[0,1] → [r,g,b].
export function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + f * (c1[k] - c0[k])));
    }
  }
  return stops[stops.length - 1][1];
}

// Build a color function for a parameter: value → "rgb(...)" or null when dry/outside.
// `range` overrides the default; `interval` snaps to discrete bands (blocky look).
export function makeColorFn(datasetName, { min, max, interval } = {}) {
  const def = paramDef(datasetName);
  const stops = RAMPS[def.ramp];
  const lo = min ?? (def.range ? def.range[0] : 0);
  const hi = max ?? (def.range ? def.range[1] : 1);
  const step = interval ?? def.interval;
  return (v) => {
    if (v == null || !isFinite(v) || v <= -900) return null; // dry / no-data
    let x = v;
    if (step) x = Math.floor(v / step) * step + step / 2; // snap to band center
    const t = (x - lo) / (hi - lo || 1);
    const [r, g, b] = rampColor(stops, t);
    return `rgb(${r},${g},${b})`;
  };
}

// Legend swatches for a parameter (band ranges + colors).
export function legendBands(datasetName, { min, max, interval } = {}) {
  const def = paramDef(datasetName);
  const stops = RAMPS[def.ramp];
  const lo = min ?? (def.range ? def.range[0] : 0);
  const hi = max ?? (def.range ? def.range[1] : 1);
  const step = interval ?? def.interval ?? (hi - lo) / 8;
  const out = [];
  for (let v = lo; v < hi - 1e-9; v += step) {
    const t = (v + step / 2 - lo) / (hi - lo || 1);
    out.push({ from: v, to: v + step, color: `rgb(${rampColor(stops, t).join(",")})` });
  }
  return { bands: out, lo, hi, label: def.label, units: def.units };
}
