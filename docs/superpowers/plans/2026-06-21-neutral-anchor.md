# Neutral Anchor (Eyedropper White Balance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an output-side, one-shot neutral anchor: three eyedroppers (black/gray/white) that the user clicks on the Result image to remove color casts and pin the tonal range, implemented as a final per-channel levels stage.

**Architecture:** Extend the existing two-implementations transform (JS reference in `src/transform.js` + GLSL mirror in `src/shader.glsl`) with a final `applyLevels` stage driven by a new `levels` param block. The eyedroppers sample the source pixel under the click, compute the value feeding the levels stage with the JS reference (no GPU readback), and solve the levels params. Default levels are identity, so existing behavior and tests are unchanged.

**Tech Stack:** Vite, Vitest, Playwright, WebGL, vanilla JS/DOM.

## Global Constraints

- The levels stage runs AFTER highlight desat, as the FINAL stage, on output `{r,g,b}` already in [0,1].
- Levels math (verbatim, per channel `c`): `n_c = clamp((in_c - black_c) / max(white_c - black_c, 1e-5), 0, 1)`; `out_c = pow(n_c, 1 / gamma_c)`.
- New param block (verbatim): `levels: { black: [0,0,0], white: [1,1,1], gamma: [1,1,1] }`. Default = exact identity.
- `applyLevels` mirrored byte-for-byte in `transform.js` and `shader.glsl`.
- `solveAnchor(mode, value, levels)` is PURE (returns a new `levels`, never mutates input). `mode` ∈ `'black' | 'gray' | 'white'`.
  - white → `white = [value.r, value.g, value.b]`; black → `black = [value.r, value.g, value.b]`.
  - gray → `n_c = clamp((value_c - black_c)/max(white_c - black_c, 1e-5), 0, 1)`, `T = (n_r+n_g+n_b)/3`, `gamma_c = ln(n_c)/ln(T)` clamped to `[0.1, 10]`; if `T<=0 || T>=1 || n_c<=0 || n_c>=1 || n_c===T` then `gamma_c = 1`.
- The eyedropper samples a 3×3 block average (clamped to image bounds) from the source canvas; the value feeding levels is `transformPixelPreAnchor(sample, params)` (channel transform + highlight desat, NO levels).
- Eyedropper buttons disabled until an image is loaded (same gate as Export).
- Presets need no new persistence code (`levels` serializes through existing save/load; `withDefaults` backfills old presets).
- ES modules. Evergreen naming (no "new"/"improved"/"enhanced"). No mocks. Tests pristine.
- Current suite baseline: 30 Vitest + 3 Playwright, all green.

---

### Task 1: Levels math, pipeline split, and anchor solver

**Files:**
- Modify: `src/defaults.js` (the `DEFAULTS` object)
- Modify: `src/transform.js` (split `transformPixel`; add `applyLevels`, `solveAnchor`)
- Test: `test/transform.test.js` (append a new describe block)

**Interfaces:**
- Consumes: `clamp01`, `curve`, `applyHighlightDesat` (already in `transform.js`); `cloneDefaults`, `DEFAULTS` (already in `defaults.js`).
- Produces:
  - `DEFAULTS.levels = { black:[0,0,0], white:[1,1,1], gamma:[1,1,1] }` (frozen).
  - `src/transform.js`:
    - `export function transformPixelPreAnchor({r,g,b}, params): {r,g,b}` — channel transform + highlight desat (no levels).
    - `export function applyLevels({r,g,b}, {black, white, gamma}): {r,g,b}` — `black/white/gamma` are 3-element arrays `[r,g,b]`.
    - `export function solveAnchor(mode, {r,g,b}, levels): {black, white, gamma}` — pure; returns a new levels object.
    - `transformPixel(px, params)` = `applyLevels(transformPixelPreAnchor(px, params), params.levels)`.

- [ ] **Step 1: Write the failing tests — append to `test/transform.test.js`**

```js
import { transformPixelPreAnchor, applyLevels, solveAnchor } from '../src/transform.js';

const IDENTITY_LEVELS = { black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] };

describe('applyLevels', () => {
  it('is identity for default levels', () => {
    const px = { r: 0.3, g: 0.6, b: 0.9 };
    const out = applyLevels(px, IDENTITY_LEVELS);
    expect(out.r).toBeCloseTo(0.3, 10);
    expect(out.g).toBeCloseTo(0.6, 10);
    expect(out.b).toBeCloseTo(0.9, 10);
  });
  it('maps the white point to 1 and the black point to 0 per channel', () => {
    const out = applyLevels({ r: 0.5, g: 0.5, b: 0.5 }, {
      black: [0.1, 0, 0], white: [0.5, 0.5, 0.5], gamma: [1, 1, 1],
    });
    expect(out.r).toBeCloseTo(1, 10); // 0.5 is the white point for r
    const blackOut = applyLevels({ r: 0.1, g: 0, b: 0 }, {
      black: [0.1, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1],
    });
    expect(blackOut.r).toBeCloseTo(0, 10);
  });
  it('keeps output within [0,1]', () => {
    const out = applyLevels({ r: 2, g: -1, b: 0.5 }, { black: [0, 0, 0], white: [1, 1, 1], gamma: [0.5, 2, 1] });
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('transformPixelPreAnchor / transformPixel split', () => {
  it('transformPixelPreAnchor excludes the levels stage', () => {
    const params = cloneDefaults();
    const px = { r: 0.2, g: 0.4, b: 0.7 };
    const pre = transformPixelPreAnchor(px, params);
    // equals channel transform + highlight desat (highlight off by default)
    expect(pre.r).toBeCloseTo(curve(0.7, params.curveR), 10);
    expect(pre.g).toBeCloseTo(curve(0.2 - 0.5 * 0.7, params.curveG), 10);
    expect(pre.b).toBeCloseTo(curve(0.4 - 0.5 * 0.7, params.curveB), 10);
  });
  it('transformPixel with default levels equals transformPixelPreAnchor', () => {
    const params = cloneDefaults();
    const px = { r: 0.2, g: 0.4, b: 0.7 };
    const full = transformPixel(px, params);
    const pre = transformPixelPreAnchor(px, params);
    expect(full).toEqual(pre);
  });
});

describe('solveAnchor', () => {
  it('white sets the white point and does not mutate input', () => {
    const levels = structuredClone(IDENTITY_LEVELS);
    const next = solveAnchor('white', { r: 0.6, g: 0.7, b: 0.8 }, levels);
    expect(next.white).toEqual([0.6, 0.7, 0.8]);
    expect(levels.white).toEqual([1, 1, 1]); // input untouched
  });
  it('black sets the black point', () => {
    const next = solveAnchor('black', { r: 0.05, g: 0.1, b: 0.02 }, structuredClone(IDENTITY_LEVELS));
    expect(next.black).toEqual([0.05, 0.1, 0.02]);
  });
  it('gray balances the sampled pixel to equal channels', () => {
    const v = { r: 0.4, g: 0.6, b: 0.2 };
    const next = solveAnchor('gray', v, structuredClone(IDENTITY_LEVELS));
    const out = applyLevels(v, next);
    expect(out.g).toBeCloseTo(out.r, 6);
    expect(out.b).toBeCloseTo(out.r, 6);
  });
  it('gray leaves gamma at 1 for degenerate samples (no NaN/Infinity)', () => {
    for (const v of [{ r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 }, { r: 0.5, g: 0.5, b: 0.5 }]) {
      const next = solveAnchor('gray', v, structuredClone(IDENTITY_LEVELS));
      for (const g of next.gamma) expect(Number.isFinite(g)).toBe(true);
      expect(next.gamma).toEqual([1, 1, 1]);
    }
  });
});

describe('DEFAULTS levels', () => {
  it('defaults to identity', () => {
    expect(DEFAULTS.levels).toEqual({ black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] });
  });
});
```

Note: `transformPixel`, `curve`, `cloneDefaults`, `DEFAULTS` are already imported at the top of the test file; only add the new import line shown.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/transform.test.js`
Expected: FAIL — `transformPixelPreAnchor` / `applyLevels` / `solveAnchor` not exported; `DEFAULTS.levels` undefined.

- [ ] **Step 3: Add the `levels` block to `src/defaults.js`**

Insert this line into the `DEFAULTS` object, after the `highlight` line:

```js
  levels: Object.freeze({
    black: Object.freeze([0, 0, 0]),
    white: Object.freeze([1, 1, 1]),
    gamma: Object.freeze([1, 1, 1]),
  }),
```

- [ ] **Step 4: Update `src/transform.js`**

Replace the existing `transformPixel` function (the block starting `// pixel channels are normalized` through its closing brace) with the following:

```js
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
```

- [ ] **Step 5: Run the full Vitest suite to verify pass + no regressions**

Run: `npx vitest run`
Expected: PASS — all prior tests still green (default levels identity keeps `transformPixel` output identical) plus the new tests.

- [ ] **Step 6: Commit**

```bash
git add src/defaults.js src/transform.js test/transform.test.js
git commit -m "Add neutral-anchor levels stage and solver to transform reference"
```

---

### Task 2: Shader mirror + uniform wiring + e2e pin

**Files:**
- Modify: `src/shader.glsl`
- Modify: `src/webgl.js` (the `u` uniform-lookup object and `render`)
- Modify: `e2e/shader.spec.js` (extend the pin with a levels-on param set)

**Interfaces:**
- Consumes: `transformPixel`, `cloneDefaults` (already imported in `shader.spec.js`); the `levels` param block from Task 1; the `createRenderer().render(params)` contract.
- Produces: shader uniforms `u_levelsBlack`, `u_levelsWhite`, `u_levelsGamma` (each vec3); `render()` sets them via `gl.uniform3f`. The e2e verifies the GLSL levels path equals the JS reference.

- [ ] **Step 1: Update the e2e pin first (failing test) — replace the body of `e2e/shader.spec.js`**

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

function levelsParams() {
  const p = cloneDefaults();
  p.levels = { black: [0.1, 0.05, 0.0], white: [0.9, 0.95, 1.0], gamma: [1.3, 1.0, 0.8] };
  return p;
}

const PARAM_SETS = [
  { label: 'defaults', params: cloneDefaults() },
  { label: 'highlight desaturation on', params: desatParams() },
  { label: 'neutral anchor levels on', params: levelsParams() },
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
Expected: FAIL on the "neutral anchor levels on" set — the shader has no levels uniforms yet, so it ignores them and diverges from the JS reference.

- [ ] **Step 3: Update `src/shader.glsl`**

Add these uniforms after line 10 (`uniform vec2 u_highlight;`):

```glsl
uniform vec3 u_levelsBlack;
uniform vec3 u_levelsWhite;
uniform vec3 u_levelsGamma;
```

Add this function after `highlightDesat` (before `main`):

```glsl
// Per-channel levels (neutral anchor). Mirrors applyLevels() in src/transform.js.
vec3 applyLevels(vec3 c, vec3 bp, vec3 wp, vec3 g) {
  vec3 n = clamp((c - bp) / max(wp - bp, vec3(1e-5)), 0.0, 1.0);
  return pow(n, 1.0 / g);
}
```

Change the final two lines of `main` so they read:

```glsl
  vec3 outColor = highlightDesat(vec3(r, g, b), u_highlight);
  outColor = applyLevels(outColor, u_levelsBlack, u_levelsWhite, u_levelsGamma);
  gl_FragColor = vec4(outColor, 1.0);
```

- [ ] **Step 4: Wire the uniforms in `src/webgl.js`**

Add to the `u` object (after the `highlight` line):

```js
    levelsBlack: gl.getUniformLocation(program, 'u_levelsBlack'),
    levelsWhite: gl.getUniformLocation(program, 'u_levelsWhite'),
    levelsGamma: gl.getUniformLocation(program, 'u_levelsGamma'),
```

Add to `render()` after the `u.highlight` line:

```js
    gl.uniform3f(u.levelsBlack, params.levels.black[0], params.levels.black[1], params.levels.black[2]);
    gl.uniform3f(u.levelsWhite, params.levels.white[0], params.levels.white[1], params.levels.white[2]);
    gl.uniform3f(u.levelsGamma, params.levels.gamma[0], params.levels.gamma[1], params.levels.gamma[2]);
```

- [ ] **Step 5: Run the e2e pin to verify it passes**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/shader.spec.js`
Expected: PASS — all three param sets match within ±2, confirming the GLSL levels equal the JS reference.

- [ ] **Step 6: Commit**

```bash
git add src/shader.glsl src/webgl.js e2e/shader.spec.js
git commit -m "Mirror neutral-anchor levels in shader and pin it"
```

---

### Task 3: Canvas coordinate-mapping helper

**Files:**
- Create: `src/coords.js`
- Test: `test/coords.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function canvasPixelFromEvent(event, canvas): { x, y }` — maps a pointer event on a (possibly CSS-scaled) canvas to an integer source-pixel coordinate clamped to the canvas's intrinsic `[0,width-1] × [0,height-1]`. Uses `event.clientX/clientY`, `canvas.getBoundingClientRect()`, and `canvas.width/height`.

- [ ] **Step 1: Write the failing test `test/coords.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { canvasPixelFromEvent } from '../src/coords.js';

// Minimal canvas stub: intrinsic size + a displayed bounding rect.
const stubCanvas = (width, height, rect) => ({
  width, height,
  getBoundingClientRect: () => rect,
});

describe('canvasPixelFromEvent', () => {
  it('maps a click through CSS scaling to the intrinsic pixel', () => {
    // intrinsic 100x80, displayed 200x160 at origin -> center click maps to (50,40)
    const canvas = stubCanvas(100, 80, { left: 0, top: 0, width: 200, height: 160 });
    expect(canvasPixelFromEvent({ clientX: 100, clientY: 80 }, canvas)).toEqual({ x: 50, y: 40 });
  });
  it('accounts for the rect offset', () => {
    const canvas = stubCanvas(100, 100, { left: 10, top: 20, width: 100, height: 100 });
    expect(canvasPixelFromEvent({ clientX: 10, clientY: 20 }, canvas)).toEqual({ x: 0, y: 0 });
  });
  it('clamps clicks outside the canvas to valid pixel bounds', () => {
    const canvas = stubCanvas(100, 100, { left: 0, top: 0, width: 100, height: 100 });
    expect(canvasPixelFromEvent({ clientX: 999, clientY: 999 }, canvas)).toEqual({ x: 99, y: 99 });
    expect(canvasPixelFromEvent({ clientX: -50, clientY: -50 }, canvas)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/coords.test.js`
Expected: FAIL — cannot resolve `../src/coords.js`.

- [ ] **Step 3: Implement `src/coords.js`**

```js
// Map a pointer event on a (possibly CSS-scaled) canvas to an integer source-pixel
// coordinate, clamped to the canvas's intrinsic bounds.
export function canvasPixelFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * canvas.width);
  const y = Math.floor((event.clientY - rect.top) / rect.height * canvas.height);
  return {
    x: Math.min(canvas.width - 1, Math.max(0, x)),
    y: Math.min(canvas.height - 1, Math.max(0, y)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/coords.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coords.js test/coords.test.js
git commit -m "Add canvas pixel coordinate mapping helper"
```

---

### Task 4: Anchor UI — buttons, sampling, click handler

**Files:**
- Modify: `index.html` (add the Anchor button block to the controls aside)
- Modify: `src/ui.js` (imports, anchor state, button wiring, result-canvas click handler, enable-on-load)
- Modify: `e2e/app.spec.js` (assert the anchor buttons exist and are disabled before load)
- Create: `e2e/anchor.spec.js` (load image, click white, assert the pixel becomes neutral)

**Interfaces:**
- Consumes: `transformPixelPreAnchor`, `solveAnchor` (Task 1); `canvasPixelFromEvent` (Task 3); `cloneDefaults` (already imported); the renderer.
- Produces: the working eyedropper UI. No new exports.

- [ ] **Step 1: Add the Anchor block to `index.html`**

Insert this block immediately after `<div id="control-groups"></div>` inside `<aside id="controls">`:

```html
        <div class="group anchor">
          <h2>Anchor</h2>
          <button id="anchor-black" disabled>Pick black</button>
          <button id="anchor-gray" disabled>Pick gray</button>
          <button id="anchor-white" disabled>Pick white</button>
          <button id="anchor-reset" disabled>Reset anchor</button>
        </div>
```

(It sits OUTSIDE `#control-groups`, so the existing `#control-groups .group` count stays 4. The `group` class reuses the existing box styling.)

- [ ] **Step 2: Update the e2e checks first (failing tests)**

In `e2e/app.spec.js`, add these assertions after the existing `#export` disabled check (before the `errors` assertion):

```js
  await expect(page.locator('#anchor-black')).toBeDisabled();
  await expect(page.locator('#anchor-gray')).toBeDisabled();
  await expect(page.locator('#anchor-white')).toBeDisabled();
  await expect(page.locator('#anchor-reset')).toBeDisabled();
```

Create `e2e/anchor.spec.js`:

```js
import { test, expect } from '@playwright/test';

// Loads a solid gray image, picks "white" on it, and asserts the clicked pixel
// becomes ~white in the result (the white anchor maps that pixel's value to 1).
test('white eyedropper anchors the clicked pixel to neutral white', async ({ page }) => {
  await page.goto('/');

  // Inject a solid gray PNG through the real file input (in-browser, no fixture file).
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'gray.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Image loaded => export + anchor buttons enabled.
  await expect(page.locator('#export')).toBeEnabled();
  await expect(page.locator('#anchor-white')).toBeEnabled();

  await page.click('#anchor-white');
  await page.locator('#result-canvas').click(); // clicks the canvas center

  const px = await page.evaluate(() => {
    const rc = document.getElementById('result-canvas');
    const o = document.createElement('canvas');
    o.width = rc.width; o.height = rc.height;
    const octx = o.getContext('2d');
    octx.drawImage(rc, 0, 0);
    const cx = Math.floor(rc.width / 2), cy = Math.floor(rc.height / 2);
    const d = octx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

  for (const channel of px) expect(channel).toBeGreaterThan(250);
});
```

- [ ] **Step 3: Run the e2e checks to verify they fail**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js e2e/anchor.spec.js`
Expected: FAIL — `#anchor-*` buttons do not exist yet (app.spec) and there is no click handler wiring (anchor.spec).

- [ ] **Step 4: Wire the anchor UI in `src/ui.js`**

Update the import lines at the top of the file:

```js
import { createRenderer } from './webgl.js';
import { cloneDefaults, withDefaults } from './defaults.js';
import { loadPresets, savePreset, deletePreset } from './presets.js';
import { transformPixelPreAnchor, solveAnchor } from './transform.js';
import { canvasPixelFromEvent } from './coords.js';
```

Add the anchor wiring. Insert this block inside `init()` immediately before the closing `}` of `init` (after the presets section):

```js
  // --- Neutral anchor (eyedroppers) ---
  const sourceCtx = sourceCanvas.getContext('2d');
  const anchorButtons = {
    black: $('anchor-black'),
    gray: $('anchor-gray'),
    white: $('anchor-white'),
  };
  const anchorResetBtn = $('anchor-reset');
  let anchorMode = null;

  function setAnchorMode(mode) {
    anchorMode = mode;
    resultCanvas.style.cursor = mode ? 'crosshair' : '';
    for (const [m, btn] of Object.entries(anchorButtons)) {
      btn.classList.toggle('active', m === mode);
    }
  }

  for (const [mode, btn] of Object.entries(anchorButtons)) {
    btn.addEventListener('click', () => setAnchorMode(anchorMode === mode ? null : mode));
  }

  // Average a 3x3 block (clamped to image bounds) around (x,y); returns channels in [0,1].
  function sampleSource(x, y) {
    const x0 = Math.max(0, x - 1), y0 = Math.max(0, y - 1);
    const x1 = Math.min(sourceCanvas.width - 1, x + 1), y1 = Math.min(sourceCanvas.height - 1, y + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const data = sourceCtx.getImageData(x0, y0, bw, bh).data;
    let r = 0, g = 0, b = 0;
    const n = bw * bh;
    for (let i = 0; i < n; i++) {
      r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2];
    }
    return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
  }

  resultCanvas.addEventListener('click', (e) => {
    if (!anchorMode || !hasImage) return;
    const { x, y } = canvasPixelFromEvent(e, resultCanvas);
    const sample = sampleSource(x, y);
    const value = transformPixelPreAnchor(sample, params);
    params.levels = solveAnchor(anchorMode, value, params.levels);
    setAnchorMode(null);
    render();
  });

  anchorResetBtn.addEventListener('click', () => {
    params.levels = cloneDefaults().levels;
    setAnchorMode(null);
    render();
  });
```

In `loadFile`, enable the anchor buttons alongside Export. Change the success block so the `exportBtn.disabled = false;` line is followed by:

```js
      anchorButtons.black.disabled = false;
      anchorButtons.gray.disabled = false;
      anchorButtons.white.disabled = false;
      anchorResetBtn.disabled = false;
```

(Note: `anchorButtons` and `anchorResetBtn` are declared later in `init()` than `loadFile`, but `loadFile` only runs on a user action, by which time `init()` has finished and the `const` bindings are initialized — this matches how the file is structured. If the implementer prefers, move the anchor `const` declarations above `loadFile`; either works as long as they are in `init()` scope.)

- [ ] **Step 5: Run the build and the e2e checks to verify they pass**

Run: `npx vite build`
Expected: build succeeds.

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js e2e/anchor.spec.js`
Expected: PASS — anchor buttons present and disabled before load (app.spec); clicking white anchors the pixel to ~white (anchor.spec).

- [ ] **Step 6: Run the entire suite to confirm everything is green together**

Run: `npx vitest run && (lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test)`
Expected: Vitest all pass; Playwright `shader.spec.js`, `app.spec.js`, `orientation.spec.js`, `anchor.spec.js` all pass.

- [ ] **Step 7: Commit**

```bash
git add index.html src/ui.js e2e/app.spec.js e2e/anchor.spec.js
git commit -m "Add neutral anchor eyedropper UI"
```

---

## Self-Review

**Spec coverage:**
- Levels stage math (n/clamp/pow, 1e-5 guard) → Task 1 (JS) + Task 2 (GLSL), pinned by Task 2 e2e. ✓
- `levels: { black:[0,0,0], white:[1,1,1], gamma:[1,1,1] }` identity default → Task 1 defaults. ✓
- Final-stage placement (after highlight desat) → Task 1 `transformPixel`, Task 2 shader `main`. ✓
- `transformPixelPreAnchor` (excludes levels) for the eyedropper → Task 1, used in Task 4. ✓
- `solveAnchor` white/black/gray with mean target + guards + purity → Task 1. ✓
- Three uniforms + render wiring → Task 2. ✓
- Click→pixel coordinate mapping → Task 3 `coords.js`. ✓
- 3×3 average sampling from the source canvas → Task 4 `sampleSource`. ✓
- Eyedropper buttons + Reset anchor; disabled until image loaded → Task 4 (index.html + loadFile enable). ✓
- Crosshair cursor / armed mode → Task 4 `setAnchorMode`. ✓
- Presets: no new code; `withDefaults` backfills `levels` for old presets → already in place (no task needed). ✓
- Tests: unit (Task 1, Task 3), e2e shader pin (Task 2), e2e app + anchor integration (Task 4). ✓
- Out-of-scope items (auto-compensate, locks, source-side, manual sliders) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `levels.{black,white,gamma}` are `[r,g,b]` arrays everywhere — defaults, `applyLevels`, `solveAnchor`, `gl.uniform3f` (indices 0/1/2), and shader vec3 uniforms. `solveAnchor(mode, {r,g,b}, levels)` and `transformPixelPreAnchor({r,g,b}, params)` signatures match their Task 4 call sites. `canvasPixelFromEvent(event, canvas) -> {x,y}` matches its Task 4 usage. The shader `applyLevels(c, bp, wp, g)` arg order matches the `gl.uniform3f` assignment order (black, white, gamma). ✓
