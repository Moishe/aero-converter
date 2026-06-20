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

// pixel channels are normalized to [0,1]; blue is the IR signal.
export function transformPixel({ r, g, b }, params) {
  const ir = b;
  return {
    r: curve(ir, params.curveR),
    g: curve(r - params.opacityG * ir, params.curveG),
    b: curve(g - params.opacityB * ir, params.curveB),
  };
}
