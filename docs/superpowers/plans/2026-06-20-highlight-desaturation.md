# Highlight Desaturation Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional final transform stage that pulls bright pixels toward a neutral gray of the same value, removing the red/magenta highlight bleed, with Amount + Threshold sliders and default off.

**Architecture:** Extend the existing two-implementations transform (pure JS reference in `src/transform.js` + GLSL mirror in `src/shader.glsl`). A new `highlight` param block flows through defaults → transform/shader → webgl uniforms → UI controls → presets. Default `amount = 0` makes the stage an exact identity, so all existing behavior and tests are preserved.

**Tech Stack:** Vite, Vitest, Playwright, WebGL, vanilla JS/DOM.

## Global Constraints

- The new stage runs AFTER the existing per-channel transform, on the output `{r,g,b}` (each already in [0,1]).
- Stage math (verbatim): `value = max(r,g,b)`; `t = clamp((value - threshold) / max(1 - threshold, 1e-5), 0, 1)`; `weight = t*t*(3 - 2*t) * amount`; `rgb = mix(rgb, vec3(value), weight)` (i.e. `channel + (value - channel) * weight`).
- smoothstep is implemented MANUALLY with the expression above (NOT the GLSL built-in `smoothstep`) in BOTH `transform.js` and `shader.glsl`, so they stay byte-for-byte equivalent.
- New param block (verbatim): `highlight: { amount: 0.0, threshold: 0.7 }`.
- `amount = 0` must be an exact identity (existing tests depend on this).
- Slider ranges: Amount 0–1 step 0.01 default 0; Threshold 0–1 step 0.01 default 0.7.
- Do NOT change the existing channel-mapping math, defaults, or curve definition.
- ES modules. Evergreen naming (no "new"/"improved"/"enhanced"). No mock implementations.
- Tests must be pristine. Existing suite is currently 17 Vitest + 3 Playwright, all green.

---

### Task 1: Transform math + default param

**Files:**
- Modify: `src/defaults.js` (the `DEFAULTS` object, lines 2-8)
- Modify: `src/transform.js` (add two functions; update `transformPixel`, lines 16-23)
- Test: `test/transform.test.js` (append a new describe block; do not alter existing tests)

**Interfaces:**
- Consumes: `clamp01`, `curve` (already in `transform.js`); `DEFAULTS`, `cloneDefaults` (already in `defaults.js`).
- Produces:
  - `src/defaults.js`: `DEFAULTS.highlight = { amount: 0.0, threshold: 0.7 }` (frozen).
  - `src/transform.js`:
    - `export function smoothstep(e0, e1, x): number` — manual smoothstep, divide-by-zero-safe.
    - `export function applyHighlightDesat({r,g,b}, {amount, threshold}): {r,g,b}` — blends toward `vec3(max(r,g,b))`; identity when `amount === 0`.
    - `transformPixel(pixel, params)` now returns `applyHighlightDesat(out, params.highlight)`.

- [ ] **Step 1: Write the failing tests — append to `test/transform.test.js`**

```js
import { smoothstep, applyHighlightDesat } from '../src/transform.js';

describe('smoothstep', () => {
  it('is 0 at or below e0 and 1 at or above e1', () => {
    expect(smoothstep(0.5, 1, 0.4)).toBe(0);
    expect(smoothstep(0.5, 1, 0.5)).toBe(0);
    expect(smoothstep(0.5, 1, 1)).toBe(1);
    expect(smoothstep(0.5, 1, 1.2)).toBe(1);
  });
  it('is 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10);
  });
  it('does not divide by zero when e0 === e1', () => {
    expect(Number.isFinite(smoothstep(1, 1, 1))).toBe(true);
  });
});

describe('applyHighlightDesat', () => {
  it('is identity when amount is 0', () => {
    const px = { r: 0.9, g: 0.2, b: 0.8 };
    expect(applyHighlightDesat(px, { amount: 0, threshold: 0.7 })).toEqual(px);
  });
  it('leaves a pixel at or below threshold untouched', () => {
    const dark = { r: 0.4, g: 0.1, b: 0.3 }; // value 0.4 <= 0.7
    expect(applyHighlightDesat(dark, { amount: 1, threshold: 0.7 })).toEqual(dark);
  });
  it('fully neutralizes a value-1 pixel to its value when fully applied', () => {
    const out = applyHighlightDesat({ r: 1, g: 0.2, b: 0.8 }, { amount: 1, threshold: 0.5 });
    expect(out.r).toBeCloseTo(1, 10);
    expect(out.g).toBeCloseTo(1, 10);
    expect(out.b).toBeCloseTo(1, 10);
  });
  it('keeps output within [0,1]', () => {
    const out = applyHighlightDesat({ r: 1, g: 0, b: 0.5 }, { amount: 1, threshold: 0 });
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('transformPixel with highlight', () => {
  it('is unchanged from the channel transform when highlight is off (default)', () => {
    const params = cloneDefaults(); // amount 0
    const out = transformPixel({ r: 0.2, g: 0.4, b: 0.7 }, params);
    expect(out.r).toBeCloseTo(curve(0.7, params.curveR), 10);
    expect(out.g).toBeCloseTo(curve(0.2 - 0.5 * 0.7, params.curveG), 10);
    expect(out.b).toBeCloseTo(curve(0.4 - 0.5 * 0.7, params.curveB), 10);
  });
});

describe('DEFAULTS highlight', () => {
  it('defaults to off', () => {
    expect(DEFAULTS.highlight).toEqual({ amount: 0.0, threshold: 0.7 });
  });
});
```

Note: `transformPixel`, `curve`, `cloneDefaults`, `DEFAULTS` are already imported at the top of the existing test file; only `smoothstep` and `applyHighlightDesat` need the new import line shown above.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/transform.test.js`
Expected: FAIL — `smoothstep` / `applyHighlightDesat` are not exported; `DEFAULTS.highlight` is undefined.

- [ ] **Step 3: Add the `highlight` block to `src/defaults.js`**

Change the `DEFAULTS` object so it reads:

```js
export const DEFAULTS = Object.freeze({
  opacityG: 0.5,
  opacityB: 0.5,
  curveR: Object.freeze({ gain: 1.0, gamma: 1.0, offset: 0.0 }),
  curveG: Object.freeze({ gain: 0.95, gamma: 1.0, offset: 0.0 }),
  curveB: Object.freeze({ gain: 1.05, gamma: 1.0, offset: 0.02 }),
  highlight: Object.freeze({ amount: 0.0, threshold: 0.7 }),
});
```

- [ ] **Step 4: Add the functions and update `transformPixel` in `src/transform.js`**

Insert these two functions after `curve` (before `transformPixel`):

```js
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
```

Then change `transformPixel` to apply the stage:

```js
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
```

- [ ] **Step 5: Run the full Vitest suite to verify pass + no regressions**

Run: `npx vitest run`
Expected: PASS — all prior tests still green (default amount 0 keeps `transformPixel` identical) plus the new highlight tests.

- [ ] **Step 6: Commit**

```bash
git add src/defaults.js src/transform.js test/transform.test.js
git commit -m "Add highlight desaturation to transform reference"
```

---

### Task 2: Shader mirror + uniform wiring + e2e pin

**Files:**
- Modify: `src/shader.glsl` (add uniform + functions; update `main`)
- Modify: `src/webgl.js` (uniform lookup in the `u` object lines 54-60; set it in `render`, lines 76-84)
- Modify: `e2e/shader.spec.js` (extend the pin to cover a highlight-on param set)

**Interfaces:**
- Consumes: `transformPixel`, `cloneDefaults` (already imported in `shader.spec.js`); the `highlight` param block from Task 1; the `createRenderer().render(params)` contract.
- Produces: shader uniform `u_highlight` (vec2: x = amount, y = threshold); `render()` sets it via `gl.uniform2f`. The e2e pin verifies the GLSL highlight path equals the JS reference.

- [ ] **Step 1: Update the e2e pin first (failing test) — replace the body of `e2e/shader.spec.js`**

Replace the file contents with:

```js
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

const PARAM_SETS = [
  { label: 'defaults (highlight off)', params: cloneDefaults() },
  { label: 'highlight desaturation on', params: desatParams() },
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
```

- [ ] **Step 2: Run the e2e pin to verify it fails**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/shader.spec.js`
Expected: FAIL on the "highlight desaturation on" set — the shader has no `u_highlight` yet, so it ignores the param and its output diverges from the JS reference (which now desaturates).

- [ ] **Step 3: Update `src/shader.glsl`**

Add this uniform after line 9 (`uniform vec3 u_curveB;`):

```glsl
uniform vec2 u_highlight; // x = amount, y = threshold
```

Add these two functions after `applyCurve` (before `main`):

```glsl
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
```

Change `main` so the final two lines read:

```glsl
  vec3 outColor = highlightDesat(vec3(r, g, b), u_highlight);
  gl_FragColor = vec4(outColor, 1.0);
```

- [ ] **Step 4: Wire the uniform in `src/webgl.js`**

Add to the `u` object (after the `curveB` line, line 59):

```js
    highlight: gl.getUniformLocation(program, 'u_highlight'),
```

Add to `render()` after the `u.curveB` line (line 82):

```js
    gl.uniform2f(u.highlight, params.highlight.amount, params.highlight.threshold);
```

- [ ] **Step 5: Run the e2e pin to verify it passes**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/shader.spec.js`
Expected: PASS — both param sets match within ±2, confirming the GLSL desaturation equals the JS reference.

- [ ] **Step 6: Commit**

```bash
git add src/shader.glsl src/webgl.js e2e/shader.spec.js
git commit -m "Mirror highlight desaturation in shader and pin it"
```

---

### Task 3: UI control group

**Files:**
- Modify: `src/ui.js` (the `CONTROLS` array, lines 5-23)
- Modify: `e2e/app.spec.js` (group-count assertion, line 10)

**Interfaces:**
- Consumes: the existing slider-build loop, `getPath`/`setPath`, and `syncControlsFromParams` in `ui.js` (handle any number of groups and nested paths like `highlight.amount`); the `highlight` param block from Task 1.
- Produces: a fourth on-screen control group "Highlights" with Amount + Threshold sliders.

- [ ] **Step 1: Update the e2e group count first (failing test) — `e2e/app.spec.js` line 10**

Change:

```js
  await expect(page.locator('#control-groups .group')).toHaveCount(3);
```

to:

```js
  await expect(page.locator('#control-groups .group')).toHaveCount(4);
```

- [ ] **Step 2: Run the app smoke test to verify it fails**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js`
Expected: FAIL — only 3 groups render; the assertion now expects 4.

- [ ] **Step 3: Add the Highlights group to the `CONTROLS` array in `src/ui.js`**

Add this group as a new entry at the end of the `CONTROLS` array (after the "Blue output" group's closing `] },`, before the array's closing `];`):

```js
  { group: 'Highlights', items: [
    { path: 'highlight.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { path: 'highlight.threshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
  ] },
```

- [ ] **Step 4: Verify the build and the app smoke test pass**

Run: `npx vite build`
Expected: build succeeds (ui.js + shader graph compile).

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js`
Expected: PASS — 4 control groups now present, no console errors, export disabled.

- [ ] **Step 5: Run the entire suite to confirm everything is green together**

Run: `npx vitest run && (lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test)`
Expected: Vitest all pass; Playwright `shader.spec.js`, `app.spec.js`, `orientation.spec.js` all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui.js e2e/app.spec.js
git commit -m "Add Highlights control group to the UI"
```

---

## Self-Review

**Spec coverage:**
- Transform stage math (value/smoothstep/weight/mix) → Task 1 (JS) + Task 2 (GLSL), pinned by Task 2 e2e. ✓
- Manual smoothstep in both implementations → Task 1 `smoothstep`, Task 2 `desatStep`, identical expression. ✓
- `highlight: { amount: 0, threshold: 0.7 }` param block → Task 1 `defaults.js`. ✓
- amount 0 = exact identity → Task 1 tests ("identity when amount is 0", "unchanged when highlight is off"). ✓
- `u_highlight` uniform + `render` wiring → Task 2 `shader.glsl` + `webgl.js`. ✓
- Presets saved after this feature ship include `highlight` automatically. Presets saved before it are missing the key; loading one requires `withDefaults(preset)` (in `src/ui.js` preset-load handler) to backfill defaults so old presets don't crash. ✓
- UI Highlights group, Amount + Threshold, ranges/defaults → Task 3 `ui.js`. ✓
- E2E shader pin extended to a highlight-on set → Task 2. ✓
- E2E app group count 3 → 4 → Task 3. ✓
- Out-of-scope items (white-blend target, hue-selective desat, channel-mapping changes) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `highlight.{amount,threshold}` used identically across defaults, `applyHighlightDesat`, `u_highlight` vec2 (x=amount, y=threshold), `gl.uniform2f` order, and the UI control paths. `smoothstep(e0,e1,x)` (JS) and `desatStep(e0,e1,x)` (GLSL) use the same argument order and expression. The blend target `vec3(value)` matches `r+(value-r)*weight`. ✓
