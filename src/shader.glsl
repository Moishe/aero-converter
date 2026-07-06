precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform float u_opacityG;
uniform float u_opacityB;
uniform float u_opacityR;
uniform vec3 u_curveR; // x=gain, y=gamma, z=offset
uniform vec3 u_curveG;
uniform vec3 u_curveB;
uniform vec2 u_highlight; // x = amount, y = threshold
uniform vec3 u_levelsBlack;
uniform vec3 u_levelsWhite;
uniform vec3 u_levelsGamma;

// Mirrors curve() in src/transform.js: linear gain/offset (clamped), then gamma.
float applyCurve(float x, vec3 c) {
  float linear = clamp(c.x * x + c.z, 0.0, 1.0);
  return pow(linear, 1.0 / c.y);
}

// Manual smoothstep matching src/transform.js (NOT the GLSL built-in).
float desatStep(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(e1 - e0, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Pull bright pixels toward a neutral gray of the same value. amount 0 = identity.
vec3 highlightDesat(vec3 rgb, vec2 h) {
  float value = max(rgb.r, max(rgb.g, rgb.b));
  float weight = desatStep(h.y, 1.0, value) * h.x;
  return mix(rgb, vec3(value), weight);
}

// Per-channel levels (neutral anchor). Mirrors applyLevels() in src/transform.js.
vec3 applyLevels(vec3 c, vec3 bp, vec3 wp, vec3 g) {
  vec3 n = clamp((c - bp) / max(wp - bp, vec3(1e-5)), 0.0, 1.0);
  return pow(n, 1.0 / g);
}

void main() {
  vec3 src = texture2D(u_image, v_uv).rgb;
  float ir = src.b;
  float r = applyCurve(ir - u_opacityR * src.g, u_curveR);
  float g = applyCurve(src.r - u_opacityG * ir, u_curveG);
  float b = applyCurve(src.g - u_opacityB * ir, u_curveB);
  vec3 outColor = highlightDesat(vec3(r, g, b), u_highlight);
  outColor = applyLevels(outColor, u_levelsBlack, u_levelsWhite, u_levelsGamma);
  gl_FragColor = vec4(outColor, 1.0);
}
