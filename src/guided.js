// Guided-auto solver: fit the per-channel levels stage so three tagged samples
// (sky/foliage/clouds) land on target aerochrome colors. Pure; never throws.

// Target output colors (channels in [0,1]), chosen from real aerochrome.
export const TARGETS = {
  sky: [0.25, 0.40, 0.75],
  foliage: [0.80, 0.15, 0.35],
  clouds: [0.92, 0.92, 0.92],
};

const GAMMA_MIN = 0.1;
const GAMMA_MAX = 10;
const EPS = 1e-4;
const IDENTITY = { black: 0, white: 1, gamma: 1 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Root of f on [lo,hi] by sign-change bisection. If f does not change sign (or is
// non-finite at an endpoint), returns the endpoint with the smaller |f| (best effort).
export function bisect(f, lo, hi, iters = 60) {
  const fLo = f(lo);
  const fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo * fHi > 0) {
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }
  let a = lo;
  let b = hi;
  let fa = fLo;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) { b = m; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

// Fit black/white/gamma for one channel from three {x, y} points. Identity on degeneracy.
function solveChannel(points) {
  const sorted = [...points].sort((p, q) => p.x - q.x);
  const [lo, mid, hi] = sorted;
  if (mid.x - lo.x < EPS || hi.x - mid.x < EPS) return { ...IDENTITY };
  for (const p of sorted) {
    if (p.y <= 0 || p.y >= 1) return { ...IDENTITY };
  }
  if (Math.abs(lo.y - mid.y) < EPS || Math.abs(mid.y - hi.y) < EPS) return { ...IDENTITY };

  const R = (lo.x - mid.x) / (mid.x - hi.x);
  const G = (gamma) => {
    const a = Math.pow(lo.y, gamma);
    const b = Math.pow(mid.y, gamma);
    const c = Math.pow(hi.y, gamma);
    return (a - b) / (b - c) - R;
  };
  const gamma = clamp(bisect(G, GAMMA_MIN, GAMMA_MAX), GAMMA_MIN, GAMMA_MAX);
  const yLo = Math.pow(lo.y, gamma);
  const yMid = Math.pow(mid.y, gamma);
  const W = (lo.x - mid.x) / (yLo - yMid);
  if (!Number.isFinite(W) || W <= EPS) return { ...IDENTITY };
  const black = clamp(lo.x - W * yLo, -1, 2);
  const white = clamp(black + W, -1, 2);
  if (white - black < EPS) return { ...IDENTITY };
  return { black, white, gamma };
}

// Fit levels from three pre-levels samples toward the targets. Channels fit independently.
export function solveGuided(preSamples, targets) {
  const regions = ['sky', 'foliage', 'clouds'];
  const channels = ['r', 'g', 'b'];
  const black = [0, 0, 0];
  const white = [1, 1, 1];
  const gamma = [1, 1, 1];
  channels.forEach((ch, ci) => {
    const points = regions.map((region) => ({
      x: preSamples[region][ch],
      y: targets[region][ci],
    }));
    const sol = solveChannel(points);
    black[ci] = sol.black;
    white[ci] = sol.white;
    gamma[ci] = sol.gamma;
  });
  return { black, white, gamma };
}
