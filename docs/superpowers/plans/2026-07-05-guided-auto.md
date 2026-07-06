# Guided Auto (Tag Sky / Foliage / Clouds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-button "Guided Auto" flow where the user tags sky, foliage, and clouds; the app fits the existing per-channel levels stage so those samples land on target aerochrome colors (blue / red / white).

**Architecture:** A new pure solver module (`src/guided.js`) fits `levels` from three sample→target points per channel via a 1-D solve for gamma. The UI reuses the eyedropper sampling machinery for a sequential three-click flow, resets to defaults, solves, and writes the existing `levels` block. No new pipeline math, shader, or defaults changes.

**Tech Stack:** Vite, Vitest, Playwright, WebGL, vanilla JS/DOM.

## Global Constraints

- Reuses the existing `levels` stage end-to-end. No change to `src/transform.js`, `src/shader.glsl`, `src/webgl.js`, or `src/defaults.js`.
- The solve always starts from `cloneDefaults()` (reset-then-solve), then computes each sample's pre-levels value with `transformPixelPreAnchor(sample, params)` and writes `params.levels = solveGuided(pre, TARGETS)`.
- `solveGuided(preSamples, targets)` is PURE. `preSamples` = `{ sky, foliage, clouds }` of `{r,g,b}` in [0,1]; `targets` = `{ sky, foliage, clouds }` of `[r,g,b]`. Returns `{ black:[r,g,b], white:[r,g,b], gamma:[r,g,b] }`.
- Per channel, fit reduces to a 1-D solve for `gamma` by bisection on `[0.1, 10]`; `gamma` clamped to `[0.1, 10]`, `black`/`white` clamped to `[-1, 2]`. A channel FALLS BACK to identity `{black:0, white:1, gamma:1}` when degenerate (inputs within `1e-4`, target denominators near zero, any target not strictly in (0,1), or `W` non-finite/`≤ 1e-4`). The solver NEVER throws.
- Target constants (verbatim): `sky [0.25, 0.40, 0.75]`, `foliage [0.80, 0.15, 0.35]`, `clouds [0.92, 0.92, 0.92]`.
- Sequential flow: one "Guided Auto" button → prompts sky, then foliage, then clouds; solves on the third click. Crosshair cursor while active. Clicking the button again, or arming any eyedropper, cancels. Disabled until an image loads.
- Sampling reuses the existing 3×3 `sampleSource` and `canvasPixelFromEvent`.
- ES modules. Evergreen naming (no "new"/"improved"/"enhanced"). No mocks. Tests pristine.
- Current suite baseline: 43 Vitest + 4 Playwright, all green.

---

### Task 1: Guided solver module

**Files:**
- Create: `src/guided.js`
- Test: `test/guided.test.js`

**Interfaces:**
- Consumes: `applyLevels` from `src/transform.js` (test only, to verify the fit).
- Produces:
  - `export const TARGETS = { sky:[0.25,0.40,0.75], foliage:[0.80,0.15,0.35], clouds:[0.92,0.92,0.92] }`.
  - `export function bisect(f, lo, hi, iters=60): number` — root by sign-change bisection; returns the closer endpoint when there is no sign change or `f` is non-finite at an end.
  - `export function solveGuided(preSamples, targets): { black:[r,g,b], white:[r,g,b], gamma:[r,g,b] }` — pure; per-channel independent fit with identity fallback.

- [ ] **Step 1: Write the failing tests `test/guided.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { solveGuided, bisect, TARGETS } from '../src/guided.js';
import { applyLevels } from '../src/transform.js';

const FEASIBLE_PRE = {
  sky: { r: 0.2, g: 0.38, b: 0.44 },
  foliage: { r: 0.5, g: 0.0475, b: 0.02 },
  clouds: { r: 0.9, g: 0.475, b: 0.5765 },
};

describe('bisect', () => {
  it('finds a root of a monotonic function', () => {
    expect(bisect((x) => x - 0.3, 0, 1)).toBeCloseTo(0.3, 4);
  });
  it('returns the closer endpoint when there is no sign change', () => {
    // f(x) = x + 1 is always positive on [0,1]; |f(0)|=1 < |f(1)|=2 -> 0
    expect(bisect((x) => x + 1, 0, 1)).toBe(0);
  });
});

describe('solveGuided', () => {
  it('maps each sample to its target for a feasible (monotonic) case', () => {
    const levels = solveGuided(FEASIBLE_PRE, TARGETS);
    for (const region of ['sky', 'foliage', 'clouds']) {
      const out = applyLevels(FEASIBLE_PRE[region], levels);
      expect(out.r).toBeCloseTo(TARGETS[region][0], 2);
      expect(out.g).toBeCloseTo(TARGETS[region][1], 2);
      expect(out.b).toBeCloseTo(TARGETS[region][2], 2);
    }
  });
  it('falls back to identity per channel for degenerate (duplicate) samples', () => {
    const pre = {
      sky: { r: 0.5, g: 0.5, b: 0.5 },
      foliage: { r: 0.5, g: 0.5, b: 0.5 },
      clouds: { r: 0.9, g: 0.9, b: 0.9 },
    };
    expect(solveGuided(pre, TARGETS)).toEqual({ black: [0, 0, 0], white: [1, 1, 1], gamma: [1, 1, 1] });
  });
  it('returns finite, in-range levels (gamma within [0.1,10]) and never throws', () => {
    const levels = solveGuided(FEASIBLE_PRE, TARGETS);
    for (const v of [...levels.black, ...levels.white, ...levels.gamma]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const g of levels.gamma) {
      expect(g).toBeGreaterThanOrEqual(0.1);
      expect(g).toBeLessThanOrEqual(10);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/guided.test.js`
Expected: FAIL — cannot resolve `../src/guided.js`.

- [ ] **Step 3: Implement `src/guided.js`**

```js
// Guided-auto solver: fit the per-channel levels stage so three tagged samples
// (sky/foliage/clouds) land on target aerochrome colors. Pure; never throws.

// Target output colors (channels in [0,1]), chosen from real aerochrome.
export const TARGETS = {
  sky: [0.25, 0.40, 0.75],
  foliage: [0.80, 0.15, 0.35],
  clouds: [0.92, 0.92, 0.92],
};

const GAMMA_MIN = 0.1;
const GAMMA_MAX = 10;
const EPS = 1e-4;
const IDENTITY = { black: 0, white: 1, gamma: 1 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Root of f on [lo,hi] by sign-change bisection. If f does not change sign (or is
// non-finite at an endpoint), returns the endpoint with the smaller |f| (best effort).
export function bisect(f, lo, hi, iters = 60) {
  const fLo = f(lo);
  const fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo * fHi > 0) {
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }
  let a = lo;
  let b = hi;
  let fa = fLo;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) { b = m; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

// Fit black/white/gamma for one channel from three {x, y} points. Identity on degeneracy.
function solveChannel(points) {
  const sorted = [...points].sort((p, q) => p.x - q.x);
  const [lo, mid, hi] = sorted;
  if (mid.x - lo.x < EPS || hi.x - mid.x < EPS) return { ...IDENTITY };
  for (const p of sorted) {
    if (p.y <= 0 || p.y >= 1) return { ...IDENTITY };
  }
  if (Math.abs(lo.y - mid.y) < EPS || Math.abs(mid.y - hi.y) < EPS) return { ...IDENTITY };

  const R = (lo.x - mid.x) / (mid.x - hi.x);
  const G = (gamma) => {
    const a = Math.pow(lo.y, gamma);
    const b = Math.pow(mid.y, gamma);
    const c = Math.pow(hi.y, gamma);
    return (a - b) / (b - c) - R;
  };
  const gamma = clamp(bisect(G, GAMMA_MIN, GAMMA_MAX), GAMMA_MIN, GAMMA_MAX);
  const yLo = Math.pow(lo.y, gamma);
  const yMid = Math.pow(mid.y, gamma);
  const W = (lo.x - mid.x) / (yLo - yMid);
  if (!Number.isFinite(W) || W <= EPS) return { ...IDENTITY };
  const black = clamp(lo.x - W * yLo, -1, 2);
  const white = clamp(black + W, -1, 2);
  if (white - black < EPS) return { ...IDENTITY };
  return { black, white, gamma };
}

// Fit levels from three pre-levels samples toward the targets. Channels fit independently.
export function solveGuided(preSamples, targets) {
  const regions = ['sky', 'foliage', 'clouds'];
  const channels = ['r', 'g', 'b'];
  const black = [0, 0, 0];
  const white = [1, 1, 1];
  const gamma = [1, 1, 1];
  channels.forEach((ch, ci) => {
    const points = regions.map((region) => ({
      x: preSamples[region][ch],
      y: targets[region][ci],
    }));
    const sol = solveChannel(points);
    black[ci] = sol.black;
    white[ci] = sol.white;
    gamma[ci] = sol.gamma;
  });
  return { black, white, gamma };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/guided.test.js`
Expected: PASS — bisection root, no-sign-change endpoint, feasible fit reproduces targets, degenerate fallback to identity, finite/in-range.

- [ ] **Step 5: Run the full Vitest suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — prior tests still green plus the new `guided` tests.

- [ ] **Step 6: Commit**

```bash
git add src/guided.js test/guided.test.js
git commit -m "Add guided-auto levels solver"
```

---

### Task 2: Guided Auto UI + e2e

**Files:**
- Modify: `index.html` (add the Guided Auto button + status element to the anchor group; add a status style)
- Modify: `src/ui.js` (import solver; enable the button on load; replace the anchor section with a combined anchor+guided section)
- Modify: `e2e/app.spec.js` (assert the guided button is disabled before load)
- Create: `e2e/guided.spec.js` (three-click flow makes foliage redder than default + red-dominant)

**Interfaces:**
- Consumes: `solveGuided`, `TARGETS` (Task 1); `transformPixelPreAnchor` (transform.js); `cloneDefaults` (defaults.js); `canvasPixelFromEvent` (coords.js); the existing `sampleSource`, `syncControlsFromParams`, `render`, `params`, `hasImage` in `init()`.
- Produces: the working Guided Auto flow. No new exports.

- [ ] **Step 1: Add the button, status element, and style to `index.html`**

In the `<aside id="controls">` anchor group, add these two lines immediately after the `<button id="anchor-reset" disabled>Reset anchor</button>` line (before that div's closing `</div>`):

```html
          <button id="guided-auto" disabled>Guided Auto</button>
          <p id="guided-status" class="guided-status" hidden></p>
```

In the `<style>` block, add this rule (next to the other `button`/`.group` rules):

```css
      .guided-status { font-size: 0.78rem; color: #9cf; margin: 0.3rem 0 0; }
```

- [ ] **Step 2: Write the failing e2e first**

In `e2e/app.spec.js`, add this assertion after the existing `#anchor-reset` disabled assertion:

```js
  await expect(page.locator('#guided-auto')).toBeDisabled();
```

Create `e2e/guided.spec.js`:

```js
import { test, expect } from '@playwright/test';

// Loads a 3-stripe image (sky | foliage | clouds source colors), runs the guided
// flow clicking each stripe in order, and asserts the foliage stripe becomes MORE
// red than it rendered by default (proving the solve ran end-to-end — foliage source
// is already reddish at identity levels, so a redder-than-default check is what
// distinguishes a working flow from a no-op) and lands red-dominant.
test('guided auto drives the foliage region toward red', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // Inject a 60x20 image: x[0,20) sky, x[20,40) foliage, x[40,60) clouds.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,51)'; ctx.fillRect(0, 0, 20, 20);   // sky source
    ctx.fillStyle = 'rgb(77,64,128)'; ctx.fillRect(20, 0, 20, 20);   // foliage source
    ctx.fillStyle = 'rgb(242,250,230)'; ctx.fillRect(40, 0, 20, 20); // clouds source
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'stripes.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#guided-auto')).toBeEnabled();

  // Read the foliage (middle) region's rendered pixel.
  const readFoliage = () => page.evaluate(() => {
    const rc = document.getElementById('result-canvas');
    const o = document.createElement('canvas');
    o.width = rc.width; o.height = rc.height;
    o.getContext('2d').drawImage(rc, 0, 0);
    const d = o.getContext('2d').getImageData(30, 10, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

  const before = await readFoliage(); // default render (levels identity)

  await page.click('#guided-auto');
  const canvas = page.locator('#result-canvas');
  const box = await canvas.boundingBox();
  // Click centers of the three stripes: 1/6, 3/6, 5/6 of the width.
  await canvas.click({ position: { x: box.width * (1 / 6), y: box.height / 2 } }); // sky
  await canvas.click({ position: { x: box.width * (3 / 6), y: box.height / 2 } }); // foliage
  await canvas.click({ position: { x: box.width * (5 / 6), y: box.height / 2 } }); // clouds

  const after = await readFoliage();

  // The solve must have run: foliage red rises from its default toward the crimson
  // target (the red channel is a feasible fit ~0.50 -> 0.80). A no-op would leave
  // `after` == `before` and fail this.
  expect(after[0], `foliage red should increase after the solve (before ${before}, after ${after})`)
    .toBeGreaterThan(before[0] + 30);
  // ...and it lands red-dominant.
  expect(after[0], `foliage R should exceed G, got ${after}`).toBeGreaterThan(after[1] + 30);
  expect(after[0], `foliage R should exceed B, got ${after}`).toBeGreaterThan(after[2] + 30);
  await expect(page.locator('#guided-status')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
```

- [ ] **Step 3: Run the e2e to verify it fails**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js e2e/guided.spec.js`
Expected: FAIL — `#guided-auto` does not exist yet (app.spec) and the flow is unwired (guided.spec).

- [ ] **Step 4: Wire the UI in `src/ui.js`**

Add the solver import after the coords import (line 5):

```js
import { solveGuided, TARGETS } from './guided.js';
```

In `loadFile`, enable the guided button alongside the others. After the `anchorResetBtn.disabled = false;` line, add:

```js
      guidedBtn.disabled = false;
```

Replace the entire existing anchor section — from the comment `// --- Neutral anchor (eyedroppers) ---` through the end of the `anchorResetBtn` click handler (its closing `});`) — with this combined anchor + guided section:

```js
  // --- Neutral anchor (eyedroppers) + guided auto ---
  const sourceCtx = sourceCanvas.getContext('2d');
  const anchorButtons = {
    black: $('anchor-black'),
    gray: $('anchor-gray'),
    white: $('anchor-white'),
  };
  const anchorResetBtn = $('anchor-reset');
  const guidedBtn = $('guided-auto');
  const guidedStatus = $('guided-status');
  let anchorMode = null;

  const GUIDED_STEPS = ['sky', 'foliage', 'clouds'];
  const GUIDED_PROMPTS = { sky: 'Click the sky', foliage: 'Click the foliage', clouds: 'Click the clouds' };
  let guidedStep = null;
  let guidedSamples = {};

  function updateCursor() {
    resultCanvas.style.cursor = (anchorMode || guidedStep) ? 'crosshair' : '';
  }

  function setGuidedStep(step) {
    guidedStep = step;
    guidedBtn.classList.toggle('active', step !== null);
    guidedStatus.hidden = step === null;
    guidedStatus.textContent = step ? GUIDED_PROMPTS[step] : '';
    updateCursor();
  }

  function setAnchorMode(mode) {
    if (mode) setGuidedStep(null); // one active interaction at a time
    anchorMode = mode;
    for (const [m, btn] of Object.entries(anchorButtons)) {
      btn.classList.toggle('active', m === mode);
    }
    updateCursor();
  }

  for (const [mode, btn] of Object.entries(anchorButtons)) {
    btn.addEventListener('click', () => setAnchorMode(anchorMode === mode ? null : mode));
  }

  guidedBtn.addEventListener('click', () => {
    if (guidedStep) {
      setGuidedStep(null);
    } else {
      setAnchorMode(null);
      guidedSamples = {};
      setGuidedStep('sky');
    }
  });

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

  function solveGuidedFromSamples() {
    params = cloneDefaults();
    const pre = {};
    for (const key of GUIDED_STEPS) pre[key] = transformPixelPreAnchor(guidedSamples[key], params);
    params.levels = solveGuided(pre, TARGETS);
    syncControlsFromParams();
    render();
  }

  resultCanvas.addEventListener('click', (e) => {
    if (!hasImage) return;
    const { x, y } = canvasPixelFromEvent(e, resultCanvas);
    if (guidedStep) {
      guidedSamples[guidedStep] = sampleSource(x, y);
      const next = GUIDED_STEPS[GUIDED_STEPS.indexOf(guidedStep) + 1];
      if (next) {
        setGuidedStep(next);
      } else {
        setGuidedStep(null);
        solveGuidedFromSamples();
      }
      return;
    }
    if (!anchorMode) return;
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

- [ ] **Step 5: Verify the build and e2e pass**

Run: `npx vite build`
Expected: build succeeds.

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/app.spec.js e2e/guided.spec.js`
Expected: PASS — guided button present and disabled before load (app.spec); the three-click flow makes the foliage stripe redder than its default render and red-dominant, and clears the status (guided.spec).

- [ ] **Step 6: Run the whole suite together**

Run: `npx vitest run && (lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test)`
Expected: Vitest all green; Playwright all specs green (app, shader, orientation, anchor, guided).

- [ ] **Step 7: Commit**

```bash
git add index.html src/ui.js e2e/app.spec.js e2e/guided.spec.js
git commit -m "Add guided auto eyedropper flow"
```

---

## Self-Review

**Spec coverage:**
- Guided one-button sequential flow (sky→foliage→clouds), crosshair, cancel, disabled-until-loaded → Task 2 (`index.html` + `ui.js` guided wiring). ✓
- Reset-to-defaults then solve; pre-levels via `transformPixelPreAnchor`; write `params.levels` → Task 2 `solveGuidedFromSamples`. ✓
- `solveGuided` per-channel fit via 1-D gamma bisection, clamps, identity fallback, never throws → Task 1. ✓
- Target constants (exact values) → Task 1 `TARGETS`. ✓
- Reuse of `sampleSource` + `canvasPixelFromEvent`; no shader/defaults/transform math change → Task 2 (section reuses them; only `ui.js`/`index.html`/`e2e` touched). ✓
- Mutual exclusion between guided and eyedroppers → Task 2 (`setAnchorMode`/`setGuidedStep` cancel each other). ✓
- Testing: unit solver (Task 1), e2e flow + app-smoke button gate (Task 2). ✓
- Out-of-scope (editable targets, full auto-detect, channel/highlight nudging, target calibration) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `solveGuided(preSamples, targets) → {black,white,gamma}` (arrays) matches its Task 2 call and the `levels` shape used by `applyLevels`/`render`/uniforms. `TARGETS` shape (`{region:[r,g,b]}`) matches `solveGuided`'s `targets[region][ci]` indexing. `preSamples[region][ch]` with `ch∈{r,g,b}` matches the `{r,g,b}` objects produced by `transformPixelPreAnchor`/`sampleSource`. `bisect(f, lo, hi, iters)` signature matches its Task 1 test and internal use. The combined `ui.js` section preserves the existing `sampleSource`, `setAnchorMode`, anchor click, and `anchorResetBtn` behavior unchanged apart from the guided additions. ✓
