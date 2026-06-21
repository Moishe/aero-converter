import { test, expect } from '@playwright/test';
import { cloneDefaults } from '../src/defaults.js';

// Regression test for the vertical-flip bug: a full-spectrum photo loaded via
// createImageBitmap() must render (and export) right-side up, not upside down.
// Reads the rendered canvas top-down via a 2D context — the same orientation
// that canvas.toBlob() exports — so this asserts what the user actually sees.
test('rendered result is not vertically flipped', async ({ page }) => {
  await page.goto('/');
  const params = cloneDefaults();
  const { top, bottom } = await page.evaluate(async (renderParams) => {
    const { createRenderer } = await import('/src/webgl.js');

    // 1x2 source via the app's real load path: TOP row red, BOTTOM row green.
    const src = document.createElement('canvas');
    src.width = 1; src.height = 2;
    const ctx = src.getContext('2d');
    ctx.fillStyle = 'rgb(255,0,0)'; ctx.fillRect(0, 0, 1, 1); // top
    ctx.fillStyle = 'rgb(0,255,0)'; ctx.fillRect(0, 1, 1, 1); // bottom
    const bitmap = await createImageBitmap(src);

    const canvas = document.createElement('canvas');
    const renderer = createRenderer(canvas);
    renderer.setImage(bitmap);
    renderer.render(renderParams);

    // Read top-down (matches display + PNG export orientation).
    const out = document.createElement('canvas');
    out.width = 1; out.height = 2;
    const octx = out.getContext('2d');
    octx.drawImage(canvas, 0, 0);
    const d = octx.getImageData(0, 0, 1, 2).data;
    return { top: [d[0], d[1], d[2]], bottom: [d[4], d[5], d[6]] };
  }, params);

  // Source TOP row is red input -> transform yields a green-dominant output.
  // Source BOTTOM row is green input -> transform yields a blue-dominant output.
  // Upright means the green-dominant pixel is on top, blue-dominant on the bottom.
  expect(top[1], `top pixel should be green-dominant (red input), got ${top}`).toBeGreaterThan(200);
  expect(top[2], `top pixel blue should be low, got ${top}`).toBeLessThan(60);
  expect(bottom[2], `bottom pixel should be blue-dominant (green input), got ${bottom}`).toBeGreaterThan(200);
  expect(bottom[1], `bottom pixel green should be low, got ${bottom}`).toBeLessThan(60);
});
