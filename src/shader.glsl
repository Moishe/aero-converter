precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform float u_opacityG;
uniform float u_opacityB;
uniform vec3 u_curveR; // x=gain, y=gamma, z=offset
uniform vec3 u_curveG;
uniform vec3 u_curveB;

// Mirrors curve() in src/transform.js: linear gain/offset (clamped), then gamma.
float applyCurve(float x, vec3 c) {
  float linear = clamp(c.x * x + c.z, 0.0, 1.0);
  return pow(linear, 1.0 / c.y);
}

void main() {
  vec3 src = texture2D(u_image, v_uv).rgb;
  float ir = src.b;
  float r = applyCurve(ir, u_curveR);
  float g = applyCurve(src.r - u_opacityG * ir, u_curveG);
  float b = applyCurve(src.g - u_opacityB * ir, u_curveB);
  gl_FragColor = vec4(r, g, b, 1.0);
}
