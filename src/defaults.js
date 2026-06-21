// Canonical default parameters, shared by the UI, presets, and tests.
export const DEFAULTS = Object.freeze({
  opacityG: 0.5,
  opacityB: 0.5,
  curveR: Object.freeze({ gain: 1.0, gamma: 1.0, offset: 0.0 }),
  curveG: Object.freeze({ gain: 0.95, gamma: 1.0, offset: 0.0 }),
  curveB: Object.freeze({ gain: 1.05, gamma: 1.0, offset: 0.02 }),
  highlight: Object.freeze({ amount: 0.0, threshold: 0.7 }),
});

// Deep, mutable copy of DEFAULTS for use as live editable state.
export function cloneDefaults() {
  return structuredClone(DEFAULTS);
}
