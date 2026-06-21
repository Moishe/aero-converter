// Canonical default parameters, shared by the UI, presets, and tests.
export const DEFAULTS = Object.freeze({
  opacityG: 0.5,
  opacityB: 0.5,
  curveR: Object.freeze({ gain: 1.0, gamma: 1.0, offset: 0.0 }),
  curveG: Object.freeze({ gain: 0.95, gamma: 1.0, offset: 0.0 }),
  curveB: Object.freeze({ gain: 1.05, gamma: 1.0, offset: 0.02 }),
  highlight: Object.freeze({ amount: 0.0, threshold: 0.7 }),
  levels: Object.freeze({
    black: Object.freeze([0, 0, 0]),
    white: Object.freeze([1, 1, 1]),
    gamma: Object.freeze([1, 1, 1]),
  }),
});

// Deep, mutable copy of DEFAULTS for use as live editable state.
export function cloneDefaults() {
  return structuredClone(DEFAULTS);
}

// Merge a preset with defaults, backfilling any top-level blocks the preset
// does not provide (e.g. presets saved before a new param block was added).
export function withDefaults(params) {
  return { ...cloneDefaults(), ...structuredClone(params) };
}
