import { describe, it, expect } from 'vitest';
import { DEFAULTS, cloneDefaults, withDefaults } from '../src/defaults.js';

describe('withDefaults', () => {
  it('backfills the highlight block when the preset is missing it', () => {
    const oldPreset = { opacityG: 0.3, opacityB: 0.4, curveR: { gain: 1.1, gamma: 1.0, offset: 0.0 }, curveG: { gain: 0.95, gamma: 1.0, offset: 0.0 }, curveB: { gain: 1.05, gamma: 1.0, offset: 0.02 } };
    const result = withDefaults(oldPreset);
    expect(result.highlight).toEqual({ amount: 0, threshold: 0.7 });
    expect(() => result.highlight.amount).not.toThrow();
  });

  it('keeps the highlight values from a preset that provides them', () => {
    const preset = { ...cloneDefaults(), highlight: { amount: 0.8, threshold: 0.5 } };
    const result = withDefaults(preset);
    expect(result.highlight).toEqual({ amount: 0.8, threshold: 0.5 });
  });

  it('returns a deep copy independent of DEFAULTS (mutating result does not affect DEFAULTS)', () => {
    const result = withDefaults({});
    result.highlight.amount = 0.99;
    expect(DEFAULTS.highlight.amount).toBe(0.0);
  });

  it('returns a deep copy independent of the input (mutating result does not affect the input)', () => {
    const preset = cloneDefaults();
    const result = withDefaults(preset);
    result.opacityG = 0.99;
    expect(preset.opacityG).toBe(0.5);
  });
});
