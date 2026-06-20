import { describe, it, expect } from 'vitest';
import { clamp01, curve, transformPixel } from '../src/transform.js';
import { DEFAULTS, cloneDefaults } from '../src/defaults.js';

const IDENTITY = { gain: 1, gamma: 1, offset: 0 };

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBeCloseTo(0.4, 10);
  });
});

describe('curve', () => {
  it('is identity for gain 1, gamma 1, offset 0', () => {
    expect(curve(0.3, IDENTITY)).toBeCloseTo(0.3, 10);
  });
  it('applies gain and offset before gamma, clamping the linear stage', () => {
    // gain*x+offset = 2*0.6+0 = 1.2 -> clamp 1 -> 1^(1/1) = 1
    expect(curve(0.6, { gain: 2, gamma: 1, offset: 0 })).toBe(1);
    // negative linear stage clamps to 0
    expect(curve(0.1, { gain: 1, gamma: 1, offset: -0.5 })).toBe(0);
  });
  it('applies gamma after the linear stage', () => {
    // clamp(0.25) ^ (1/2) = 0.5
    expect(curve(0.25, { gain: 1, gamma: 2, offset: 0 })).toBeCloseTo(0.5, 10);
  });
});

describe('transformPixel', () => {
  it('maps IR (blue) to the red output channel', () => {
    const out = transformPixel({ r: 0.2, g: 0.4, b: 0.7 }, {
      ...cloneDefaults(), curveR: IDENTITY,
    });
    expect(out.r).toBeCloseTo(0.7, 10);
  });
  it('subtracts IR from the source red for the green output', () => {
    const out = transformPixel({ r: 0.8, g: 0.0, b: 0.4 }, {
      ...cloneDefaults(), opacityG: 0.5, curveG: IDENTITY,
    });
    // 0.8 - 0.5*0.4 = 0.6
    expect(out.g).toBeCloseTo(0.6, 10);
  });
  it('subtracts IR from the source green for the blue output', () => {
    const out = transformPixel({ r: 0.0, g: 0.9, b: 0.4 }, {
      ...cloneDefaults(), opacityB: 0.5, curveB: IDENTITY,
    });
    // 0.9 - 0.5*0.4 = 0.7
    expect(out.b).toBeCloseTo(0.7, 10);
  });
  it('keeps all outputs within [0,1]', () => {
    const out = transformPixel({ r: 1, g: 1, b: 0 }, cloneDefaults());
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('DEFAULTS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULTS.opacityG).toBe(0.5);
    expect(DEFAULTS.opacityB).toBe(0.5);
    expect(DEFAULTS.curveR).toEqual({ gain: 1.0, gamma: 1.0, offset: 0.0 });
    expect(DEFAULTS.curveG).toEqual({ gain: 0.95, gamma: 1.0, offset: 0.0 });
    expect(DEFAULTS.curveB).toEqual({ gain: 1.05, gamma: 1.0, offset: 0.02 });
  });
  it('cloneDefaults returns an independent copy', () => {
    const a = cloneDefaults();
    a.curveR.gain = 99;
    expect(DEFAULTS.curveR.gain).toBe(1.0);
  });
});
