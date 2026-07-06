import { describe, it, expect } from 'vitest';
import { clamp01, curve, transformPixel, smoothstep, applyHighlightDesat, transformPixelPreAnchor, applyLevels, solveAnchor } from '../src/transform.js';
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

describe('smoothstep', () => {
  it('is 0 at or below e0 and 1 at or above e1', () => {
    expect(smoothstep(0.5, 1, 0.4)).toBe(0);
    expect(smoothstep(0.5, 1, 0.5)).toBe(0);
    expect(smoothstep(0.5, 1, 1)).toBe(1);
    expect(smoothstep(0.5, 1, 1.2)).toBe(1);
  });
  it('is 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10);
  });
  it('does not divide by zero when e0 === e1', () => {
    expect(Number.isFinite(smoothstep(1, 1, 1))).toBe(true);
  });
});

describe('applyHighlightDesat', () => {
  it('is identity when amount is 0', () => {
    const px = { r: 0.9, g: 0.2, b: 0.8 };
    expect(applyHighlightDesat(px, { amount: 0, threshold: 0.7 })).toEqual(px);
  });
  it('leaves a pixel at or below threshold untouched', () => {
    const dark = { r: 0.4, g: 0.1, b: 0.3 }; // value 0.4 <= 0.7
    expect(applyHighlightDesat(dark, { amount: 1, threshold: 0.7 })).toEqual(dark);
  });
  it('fully neutralizes a value-1 pixel to its value when fully applied', () => {
    const out = applyHighlightDesat({ r: 1, g: 0.2, b: 0.8 }, { amount: 1, threshold: 0.5 });
    expect(out.r).toBeCloseTo(1, 10);
    expect(out.g).toBeCloseTo(1, 10);
    expect(out.b).toBeCloseTo(1, 10);
  });
  it('keeps output within [0,1]', () => {
    const out = applyHighlightDesat({ r: 1, g: 0, b: 0.5 }, { amount: 1, threshold: 0 });
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('transformPixel with highlight', () => {
  it('is unchanged from the channel transform when highlight is off (default)', () => {
    const params = cloneDefaults(); // amount 0
    const out = transformPixel({ r: 0.2, g: 0.4, b: 0.7 }, params);
    expect(out.r).toBeCloseTo(curve(0.7, params.curveR), 10);
    expect(out.g).toBeCloseTo(curve(0.2 - 0.5 * 0.7, params.curveG), 10);
    expect(out.b).toBeCloseTo(curve(0.4 - 0.5 * 0.7, params.curveB), 10);
  });
});

describe('DEFAULTS highlight', () => {
  it('defaults to off', () => {
    expect(DEFAULTS.highlight).toEqual({ amount: 0.0, threshold: 0.7 });
  });
});

const IDENTITY_LEVELS = { black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] };

describe('applyLevels', () => {
  it('is identity for default levels', () => {
    const px = { r: 0.3, g: 0.6, b: 0.9 };
    const out = applyLevels(px, IDENTITY_LEVELS);
    expect(out.r).toBeCloseTo(0.3, 10);
    expect(out.g).toBeCloseTo(0.6, 10);
    expect(out.b).toBeCloseTo(0.9, 10);
  });
  it('maps the white point to 1 and the black point to 0 per channel', () => {
    const out = applyLevels({ r: 0.5, g: 0.5, b: 0.5 }, {
      black: [0.1, 0, 0], white: [0.5, 0.5, 0.5], gamma: [1, 1, 1],
    });
    expect(out.r).toBeCloseTo(1, 10); // 0.5 is the white point for r
    const blackOut = applyLevels({ r: 0.1, g: 0, b: 0 }, {
      black: [0.1, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1],
    });
    expect(blackOut.r).toBeCloseTo(0, 10);
  });
  it('keeps output within [0,1]', () => {
    const out = applyLevels({ r: 2, g: -1, b: 0.5 }, { black: [0, 0, 0], white: [1, 1, 1], gamma: [0.5, 2, 1] });
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('transformPixelPreAnchor / transformPixel split', () => {
  it('transformPixelPreAnchor excludes the levels stage', () => {
    const params = cloneDefaults();
    const px = { r: 0.2, g: 0.4, b: 0.7 };
    const pre = transformPixelPreAnchor(px, params);
    // equals channel transform + highlight desat (highlight off by default)
    expect(pre.r).toBeCloseTo(curve(0.7, params.curveR), 10);
    expect(pre.g).toBeCloseTo(curve(0.2 - 0.5 * 0.7, params.curveG), 10);
    expect(pre.b).toBeCloseTo(curve(0.4 - 0.5 * 0.7, params.curveB), 10);
  });
  it('transformPixel with default levels equals transformPixelPreAnchor', () => {
    const params = cloneDefaults();
    const px = { r: 0.2, g: 0.4, b: 0.7 };
    const full = transformPixel(px, params);
    const pre = transformPixelPreAnchor(px, params);
    expect(full).toEqual(pre);
  });
});

describe('solveAnchor', () => {
  it('white sets the white point and does not mutate input', () => {
    const levels = structuredClone(IDENTITY_LEVELS);
    const next = solveAnchor('white', { r: 0.6, g: 0.7, b: 0.8 }, levels);
    expect(next.white).toEqual([0.6, 0.7, 0.8]);
    expect(levels.white).toEqual([1, 1, 1]); // input untouched
  });
  it('black sets the black point', () => {
    const next = solveAnchor('black', { r: 0.05, g: 0.1, b: 0.02 }, structuredClone(IDENTITY_LEVELS));
    expect(next.black).toEqual([0.05, 0.1, 0.02]);
  });
  it('gray balances the sampled pixel to equal channels', () => {
    const v = { r: 0.4, g: 0.6, b: 0.2 };
    const next = solveAnchor('gray', v, structuredClone(IDENTITY_LEVELS));
    const out = applyLevels(v, next);
    expect(out.g).toBeCloseTo(out.r, 6);
    expect(out.b).toBeCloseTo(out.r, 6);
  });
  it('gray leaves gamma at 1 for degenerate samples (no NaN/Infinity)', () => {
    for (const v of [{ r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 }, { r: 0.5, g: 0.5, b: 0.5 }]) {
      const next = solveAnchor('gray', v, structuredClone(IDENTITY_LEVELS));
      for (const g of next.gamma) expect(Number.isFinite(g)).toBe(true);
      expect(next.gamma).toEqual([1, 1, 1]);
    }
  });
});

describe('DEFAULTS levels', () => {
  it('defaults to identity', () => {
    expect(DEFAULTS.levels).toEqual({ black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] });
  });
});

describe('opacityR', () => {
  it('defaults to 0 in DEFAULTS', () => {
    expect(DEFAULTS.opacityR).toBe(0);
  });
  it('default 0 leaves the red channel identical to curveR(ir)', () => {
    const params = cloneDefaults();
    const out = transformPixel({ r: 0.3, g: 0.6, b: 0.4 }, params);
    expect(out.r).toBeCloseTo(curve(0.4, params.curveR), 10);
  });
  it('subtracts opacityR times source green from the red input', () => {
    const params = cloneDefaults();
    params.opacityR = 0.5;
    params.curveR = { gain: 1, gamma: 1, offset: 0 };
    const out = transformPixel({ r: 0.0, g: 0.6, b: 0.9 }, params);
    // ir − 0.5·sg = 0.9 − 0.30 = 0.6
    expect(out.r).toBeCloseTo(0.6, 10);
  });
});
