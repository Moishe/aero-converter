import { describe, it, expect } from 'vitest';
import { solveGuided, bisect, TARGETS } from '../src/guided.js';
import { applyLevels } from '../src/transform.js';

const FEASIBLE_PRE = {
  sky: { r: 0.30000000000000004, g: 0.45999999999999996, b: 0.75 },
  foliage: { r: 0.7400000000000001, g: 0.2975, b: 0.42999999999999994 },
  clouds: { r: 0.8360000000000001, g: 0.798, b: 0.886 },
};

describe('bisect', () => {
  it('finds a root of a monotonic function', () => {
    expect(bisect((x) => x - 0.3, 0, 1)).toBeCloseTo(0.3, 4);
  });
  it('returns the closer endpoint when there is no sign change', () => {
    // f(x) = x + 1 is always positive on [0,1]; |f(0)|=1 < |f(1)|=2 -> 0
    expect(bisect((x) => x + 1, 0, 1)).toBe(0);
  });
});

describe('solveGuided', () => {
  it('maps each sample to its target for a feasible (monotonic) case', () => {
    const levels = solveGuided(FEASIBLE_PRE, TARGETS);
    for (const region of ['sky', 'foliage', 'clouds']) {
      const out = applyLevels(FEASIBLE_PRE[region], levels);
      expect(out.r).toBeCloseTo(TARGETS[region][0], 2);
      expect(out.g).toBeCloseTo(TARGETS[region][1], 2);
      expect(out.b).toBeCloseTo(TARGETS[region][2], 2);
    }
  });
  it('falls back to identity per channel for degenerate (duplicate) samples', () => {
    const pre = {
      sky: { r: 0.5, g: 0.5, b: 0.5 },
      foliage: { r: 0.5, g: 0.5, b: 0.5 },
      clouds: { r: 0.9, g: 0.9, b: 0.9 },
    };
    expect(solveGuided(pre, TARGETS)).toEqual({ black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] });
  });
  it('returns finite, in-range levels (gamma within [0.1,10]) and never throws', () => {
    const levels = solveGuided(FEASIBLE_PRE, TARGETS);
    for (const v of [...levels.black, ...levels.white, ...levels.gamma]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const g of levels.gamma) {
      expect(g).toBeGreaterThanOrEqual(0.1);
      expect(g).toBeLessThanOrEqual(10);
    }
  });
});
