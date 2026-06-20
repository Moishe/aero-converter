import { test, expect } from '@playwright/test';
import { transformPixel } from '../src/transform.js';
import { cloneDefaults } from '../src/defaults.js';

const COLORS = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [120, 200, 80],
  [200, 50, 150],
];

test('shader output matches the transform.js reference', async ({ page }) => {
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => typeof window.renderSolid === 'function');

  const params = cloneDefaults();
  for (const [r, g, b] of COLORS) {
    const actual = await page.evaluate(
      ([r, g, b, params]) => window.renderSolid(r, g, b, params),
      [r, g, b, params],
    );
    const ref = transformPixel({ r: r / 255, g: g / 255, b: b / 255 }, params);
    const expected = [ref.r, ref.g, ref.b].map((v) => Math.round(v * 255));
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(actual[i] - expected[i]),
        `color ${r},${g},${b} channel ${i}: shader ${actual[i]} vs ref ${expected[i]}`)
        .toBeLessThanOrEqual(2);
    }
  }
});
