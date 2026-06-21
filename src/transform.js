// Pure reference implementation of the IRG transform. Mirrored in src/shader.glsl.

export function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Per-channel curve: linear gain/offset (clamped), then gamma.
export function curve(x, { gain, gamma, offset }) {
  const linear = clamp01(gain * x + offset);
  return Math.pow(linear, 1 / gamma);
}

// Manual smoothstep mirroring the GLSL expression in src/shader.glsl (NOT the
// built-in smoothstep), so the JS reference and the shader stay equivalent.
export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / Math.max(e1 - e0, 1e-5));
  return t * t * (3 - 2 * t);
}

// Pull bright pixels toward a neutral gray of the same value. amount 0 = identity.
export function applyHighlightDesat({ r, g, b }, { amount, threshold }) {
  const value = Math.max(r, g, b);
  const weight = smoothstep(threshold, 1, value) * amount;
  return {
    r: r + (value - r) * weight,
    g: g + (value - g) * weight,
    b: b + (value - b) * weight,
  };
}

// pixel channels are normalized to [0,1]; blue is the IR signal. This produces the
// output BEFORE the neutral-anchor levels stage (channel transform + highlight desat).
export function transformPixelPreAnchor({ r, g, b }, params) {
  const ir = b;
  const out = {
    r: curve(ir, params.curveR),
    g: curve(r - params.opacityG * ir, params.curveG),
    b: curve(g - params.opacityB * ir, params.curveB),
  };
  return applyHighlightDesat(out, params.highlight);
}

// Per-channel levels (neutral anchor). black/white/gamma are 3-element [r,g,b] arrays.
// Mirrored in src/shader.glsl. Default (black 0, white 1, gamma 1) is identity.
export function applyLevels({ r, g, b }, { black, white, gamma }) {
  const channel = (v, bp, wp, g) => {
    const n = clamp01((v - bp) / Math.max(wp - bp, 1e-5));
    return Math.pow(n, 1 / g);
  };
  return {
    r: channel(r, black[0], white[0], gamma[0]),
    g: channel(g, black[1], white[1], gamma[1]),
    b: channel(b, black[2], white[2], gamma[2]),
  };
}

// Solve updated levels from an eyedropper sample. Pure: returns a new levels object.
// `value` is the pre-anchor output color at the sampled pixel (channels in [0,1]).
export function solveAnchor(mode, { r, g, b }, levels) {
  const next = {
    black: [...levels.black],
    white: [...levels.white],
    gamma: [...levels.gamma],
  };
  if (mode === 'white') {
    next.white = [r, g, b];
  } else if (mode === 'black') {
    next.black = [r, g, b];
  } else if (mode === 'gray') {
    const v = [r, g, b];
    const n = v.map((x, i) => clamp01((x - next.black[i]) / Math.max(next.white[i] - next.black[i], 1e-5)));
    const T = (n[0] + n[1] + n[2]) / 3;
    next.gamma = n.map((nc) => {
      if (T <= 0 || T >= 1 || nc <= 0 || nc >= 1 || nc === T) return 1;
      const g = Math.log(nc) / Math.log(T);
      return Math.min(10, Math.max(0.1, g));
    });
  }
  return next;
}

// Full transform: channel mapping + highlight desat + neutral-anchor levels.
export function transformPixel(px, params) {
  return applyLevels(transformPixelPreAnchor(px, params), params.levels);
}
