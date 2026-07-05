import { describe, it, expect } from 'vitest';
import { solveGuided, TARGETS } from '../src/guided.js';
import { transformPixel } from '../src/transform.js';
import { cloneDefaults, DEFAULTS } from '../src/defaults.js';

// Real-world regression fixture: source samples captured from a full-spectrum
// desert photo where the levels-based solver failed (console capture, 2026-07-05).
const DESERT = {
  sky: { r: 0.659, g: 0.515, b: 0.101 },
  foliage: { r: 0.459, g: 0.183, b: 0.177 },
  clouds: { r: 1.000, g: 0.753, b: 0.539 },
};

const REGIONS = ['sky', 'foliage', 'clouds'];

function paramsWith(solved) {
  const params = cloneDefaults();
  Object.assign(params, solved);
  return params;
}

describe('solveGuided (recipe solver)', () => {
  it('reproduces all nine targets on the desert regression fixture', () => {
    const solved = solveGuided(DESERT, TARGETS);
    const params = paramsWith(solved);
    for (const region of REGIONS) {
      const out = transformPixel(DESERT[region], params);
      expect(Math.abs(out.r - TARGETS[region][0]), `${region} r`).toBeLessThan(0.02);
      expect(Math.abs(out.g - TARGETS[region][1]), `${region} g`).toBeLessThan(0.02);
      expect(Math.abs(out.b - TARGETS[region][2]), `${region} b`).toBeLessThan(0.02);
    }
  });

  it('solves a feasible synthetic case near-exactly', () => {
    const sources = {
      sky: { r: 0.7, g: 0.5, b: 0.2 },
      foliage: { r: 0.4, g: 0.2, b: 0.6 },
      clouds: { r: 0.9, g: 0.8, b: 0.5 },
    };
    const known = paramsWith({
      opacityR: 0.2, opacityG: 0.4, opacityB: 0.3,
      curveR: { gain: 1.1, gamma: 1.5, offset: 0.05 },
      curveG: { gain: 0.9, gamma: 0.8, offset: 0.1 },
      curveB: { gain: 1.2, gamma: 1.2, offset: 0.0 },
    });
    const targets = {};
    for (const region of REGIONS) {
      const out = transformPixel(sources[region], known);
      targets[region] = [out.r, out.g, out.b];
    }
    const solved = solveGuided(sources, targets);
    const params = paramsWith(solved);
    for (const region of REGIONS) {
      const out = transformPixel(sources[region], params);
      for (const [ci, ch] of [[0, 'r'], [1, 'g'], [2, 'b']]) {
        expect(Math.abs(out[ch] - targets[region][ci]), `${region} ${ch}`).toBeLessThan(1e-3);
      }
    }
  });

  it('returns params within slider ranges and never throws', () => {
    const solved = solveGuided(DESERT, TARGETS);
    for (const k of ['opacityR', 'opacityG', 'opacityB']) {
      expect(solved[k]).toBeGreaterThanOrEqual(0);
      expect(solved[k]).toBeLessThanOrEqual(1);
    }
    for (const c of ['curveR', 'curveG', 'curveB']) {
      expect(solved[c].gain).toBeGreaterThanOrEqual(0);
      expect(solved[c].gain).toBeLessThanOrEqual(2);
      expect(solved[c].gamma).toBeGreaterThanOrEqual(0.1);
      expect(solved[c].gamma).toBeLessThanOrEqual(10);
      expect(solved[c].offset).toBeGreaterThanOrEqual(-0.5);
      expect(solved[c].offset).toBeLessThanOrEqual(0.5);
      for (const v of [solved[c].gain, solved[c].gamma, solved[c].offset]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    expect(solveGuided(DESERT, TARGETS)).toEqual(solveGuided(DESERT, TARGETS));
  });

  it('keeps channel defaults when samples are inseparable', () => {
    const flat = { r: 0.5, g: 0.5, b: 0.5 };
    const solved = solveGuided({ sky: flat, foliage: flat, clouds: flat }, TARGETS);
    expect(solved.opacityR).toBe(DEFAULTS.opacityR);
    expect(solved.opacityG).toBe(DEFAULTS.opacityG);
    expect(solved.opacityB).toBe(DEFAULTS.opacityB);
    expect(solved.curveR).toEqual({ ...DEFAULTS.curveR });
    expect(solved.curveG).toEqual({ ...DEFAULTS.curveG });
    expect(solved.curveB).toEqual({ ...DEFAULTS.curveB });
  });
});
