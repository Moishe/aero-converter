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

function desatParams() {
  const p = cloneDefaults();
  p.highlight = { amount: 1, threshold: 0.5 };
  return p;
}

function levelsParams() {
  const p = cloneDefaults();
  p.levels = { black: [0.1, 0.05, 0.0], white: [0.9, 0.95, 1.0], gamma: [1.3, 1.0, 0.8] };
  return p;
}

function opacityRParams() {
  const p = cloneDefaults();
  p.opacityR = 0.3;
  p.curveR = { gain: 1.2, gamma: 7, offset: 0.05 };
  return p;
}

const PARAM_SETS = [
  { label: 'defaults', params: cloneDefaults() },
  { label: 'highlight desaturation on', params: desatParams() },
  { label: 'neutral anchor levels on', params: levelsParams() },
  { label: 'red visible-opacity on', params: opacityRParams() },
];

test('shader output matches the transform.js reference', async ({ page }) => {
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => typeof window.renderSolid === 'function');

  for (const { label, params } of PARAM_SETS) {
    for (const [r, g, b] of COLORS) {
      const actual = await page.evaluate(
        ([r, g, b, params]) => window.renderSolid(r, g, b, params),
        [r, g, b, params],
      );
      const ref = transformPixel({ r: r / 255, g: g / 255, b: b / 255 }, params);
      const expected = [ref.r, ref.g, ref.b].map((v) => Math.round(v * 255));
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(actual[i] - expected[i]),
          `[${label}] color ${r},${g},${b} channel ${i}: shader ${actual[i]} vs ref ${expected[i]}`)
          .toBeLessThanOrEqual(2);
      }
    }
  }
});
