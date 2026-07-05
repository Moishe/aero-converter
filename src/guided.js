import { DEFAULTS } from './defaults.js';

// Guided-auto solver: fit the recipe's own controls (IR-subtraction opacities and
// per-channel curves) so three tagged samples (sky/foliage/clouds) land on target
// aerochrome colors. Pure; deterministic; never throws.

// Target output colors (channels in [0,1]), chosen from real aerochrome.
export const TARGETS = {
  sky: [0.25, 0.40, 0.75],
  foliage: [0.80, 0.15, 0.35],
  clouds: [0.92, 0.92, 0.92],
};

const REGIONS = ['sky', 'foliage', 'clouds'];
const GAMMA_MIN = 0.1;
const GAMMA_MAX = 10;
const GAIN_MIN = 0;
const GAIN_MAX = 2;
const OFFSET_MIN = -0.5;
const OFFSET_MAX = 0.5;
const K_STEP = 0.02;
const K_REFINE_STEP = 0.002;
const GAMMA_GRID_COUNT = 61;
const SEPARATION_EPS = 1e-3;
const GAMMA_REGULARIZER = 1e-5;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function logSpace(lo, hi, count) {
  const out = [];
  const llo = Math.log(lo);
  const lhi = Math.log(hi);
  for (let i = 0; i < count; i++) out.push(Math.exp(llo + (lhi - llo) * (i / (count - 1))));
  out[0] = lo;
  out[count - 1] = hi;
  return out;
}

const GAMMA_GRID = logSpace(GAMMA_MIN, GAMMA_MAX, GAMMA_GRID_COUNT);

// The recipe curve: clamped linear stage, then gamma. Matches curve() in transform.js.
function curveValue(x, gain, gamma, offset) {
  const linear = clamp(gain * x + offset, 0, 1);
  return Math.pow(linear, 1 / gamma);
}

// Score one (xs, gamma) candidate: for targets in (0,1), y = (gain·x + offset)^(1/gamma)
// is linear in gain/offset once gamma is fixed (y^gamma = gain·x + offset), so the
// best line through (x_i, y_i^gamma) is a closed-form least-squares fit. The residual
// is measured through the REAL clamped curve; a tiny regularizer breaks ties toward
// moderate gamma without ever trading visible target error.
function evaluate(xs, ys, gamma) {
  const zs = [Math.pow(ys[0], gamma), Math.pow(ys[1], gamma), Math.pow(ys[2], gamma)];
  const mx = (xs[0] + xs[1] + xs[2]) / 3;
  const mz = (zs[0] + zs[1] + zs[2]) / 3;
  let sxx = 0;
  let sxz = 0;
  for (let i = 0; i < 3; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxz += (xs[i] - mx) * (zs[i] - mz);
  }
  const gain = clamp(sxx > 0 ? sxz / sxx : 0, GAIN_MIN, GAIN_MAX);
  const offset = clamp(mz - gain * mx, OFFSET_MIN, OFFSET_MAX);
  let residual = 0;
  for (let i = 0; i < 3; i++) {
    const d = curveValue(xs[i], gain, gamma, offset) - ys[i];
    residual += d * d;
  }
  const lg = Math.log(gamma);
  return { score: residual + GAMMA_REGULARIZER * lg * lg, gain, offset };
}

// Golden-section minimization of f over [lo, hi].
function goldenMin(f, lo, hi, iters = 24) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
  }
  return fc < fd ? c : d;
}

function subtracted(as, bs, k) {
  const xs = [as[0] - k * bs[0], as[1] - k * bs[1], as[2] - k * bs[2]];
  const spread = Math.max(xs[0], xs[1], xs[2]) - Math.min(xs[0], xs[1], xs[2]);
  return spread >= SEPARATION_EPS ? xs : null;
}

// Fit (k, gain, gamma, offset) for one channel from three (a, b, target) points.
// For each candidate k, the best gamma is found by a coarse log-grid scan followed
// by golden-section refinement. Per-k refinement matters: the exact-fit family can
// sit at a k whose coarse-grid cell scores worse than a distant local optimum, so
// refining only around the single best coarse cell can converge to a near-miss.
// Returns the best candidate, or null when no k separates the samples.
function solveChannel(as, bs, ys) {
  const evaluateK = (k) => {
    const xs = subtracted(as, bs, k);
    if (!xs) return null;
    let bestGrid = null;
    for (const gamma of GAMMA_GRID) {
      const e = evaluate(xs, ys, gamma);
      if (!bestGrid || e.score < bestGrid.score) {
        bestGrid = { k, gamma, gain: e.gain, offset: e.offset, score: e.score };
      }
    }
    const gLo = clamp(bestGrid.gamma / 2, GAMMA_MIN, GAMMA_MAX);
    const gHi = clamp(bestGrid.gamma * 2, GAMMA_MIN, GAMMA_MAX);
    const gamma = goldenMin((g) => evaluate(xs, ys, g).score, gLo, gHi);
    const e = evaluate(xs, ys, gamma);
    return e.score < bestGrid.score
      ? { k, gamma, gain: e.gain, offset: e.offset, score: e.score }
      : bestGrid;
  };

  let best = null;
  for (let i = 0; i <= 50; i++) {
    const c = evaluateK(i * K_STEP);
    if (c && (!best || c.score < best.score)) best = c;
  }
  if (!best) return null;

  // Fine k sweep around the winner, same per-k gamma refinement.
  const k0 = best.k;
  for (let i = -10; i <= 10; i++) {
    const c = evaluateK(clamp(k0 + i * K_REFINE_STEP, 0, 1));
    if (c && c.score < best.score) best = c;
  }
  return best;
}

// Per-channel inputs: red fits ir − k·green_src; green/blue fit their source
// channel minus k·ir (the recipe's IR subtraction).
const CHANNELS = [
  { curve: 'curveR', opacity: 'opacityR', a: (s) => s.b, b: (s) => s.g, ti: 0 },
  { curve: 'curveG', opacity: 'opacityG', a: (s) => s.r, b: (s) => s.b, ti: 1 },
  { curve: 'curveB', opacity: 'opacityB', a: (s) => s.g, b: (s) => s.b, ti: 2 },
];

// Fit recipe controls from three raw source samples toward the targets.
export function solveGuided(sourceSamples, targets) {
  const solved = {};
  for (const ch of CHANNELS) {
    const as = REGIONS.map((region) => ch.a(sourceSamples[region]));
    const bs = REGIONS.map((region) => ch.b(sourceSamples[region]));
    const ys = REGIONS.map((region) => targets[region][ch.ti]);
    const fit = solveChannel(as, bs, ys);
    if (fit) {
      solved[ch.opacity] = fit.k;
      solved[ch.curve] = { gain: fit.gain, gamma: fit.gamma, offset: fit.offset };
    } else {
      solved[ch.opacity] = DEFAULTS[ch.opacity];
      solved[ch.curve] = { ...DEFAULTS[ch.curve] };
    }
  }
  return solved;
}
