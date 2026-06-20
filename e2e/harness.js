import { createRenderer } from '/src/webgl.js';

const renderer = createRenderer(document.getElementById('c'));

// Render a solid color through the shader and return its center output pixel [r,g,b] (0-255).
window.renderSolid = function (r, g, b, params) {
  const src = document.createElement('canvas');
  src.width = 4; src.height = 4;
  const ctx = src.getContext('2d');
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, 4, 4);
  renderer.setImage(src);
  renderer.render(params);
  const { data } = renderer.readPixels();
  const idx = (2 * 4 + 2) * 4; // center pixel of a 4x4 buffer
  return [data[idx], data[idx + 1], data[idx + 2]];
};
