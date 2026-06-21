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

// pixel channels are normalized to [0,1]; blue is the IR signal.
export function transformPixel({ r, g, b }, params) {
  const ir = b;
  const out = {
    r: curve(ir, params.curveR),
    g: curve(r - params.opacityG * ir, params.curveG),
    b: curve(g - params.opacityB * ir, params.curveB),
  };
  return applyHighlightDesat(out, params.highlight);
}
