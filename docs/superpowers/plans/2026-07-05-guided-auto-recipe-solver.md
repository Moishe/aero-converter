# Guided Auto Recipe Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the guided-auto levels fit with a solver that tunes the recipe's own controls (IR-subtraction opacities + per-channel curves), adding an `opacityR` control and widening gamma ranges so real photos are solvable.

**Architecture:** A new `opacityR` param flows through defaults → transform → shader → UI (default 0 = today's behavior). `src/guided.js` is rewritten as a per-channel search over `(opacity k, gamma)` with a closed-form gain/offset line fit at each point (via the `y^gamma = gain·x + offset` linearization), scored through the real clamped curve. The guided three-click UX is unchanged; the solve now writes visible sliders and leaves levels at identity.

**Tech Stack:** Vite, Vitest, Playwright, WebGL, vanilla JS/DOM.

## Global Constraints

- Recipe mapping (verbatim): `ir = sb`; `R_out = curveR(ir − opacityR·sg)`; `G_out = curveG(sr − opacityG·ir)`; `B_out = curveB(sg − opacityB·ir)`. `opacityR` default 0.0 must be bit-identical to current behavior.
- Shader mirrors the JS reference byte-for-byte; the e2e shader-pin must cover an `opacityR ≠ 0` param set.
- Solver: `solveGuided(sourceSamples, targets)` takes RAW source samples (`{sky,foliage,clouds}` of `{r,g,b}` in [0,1]) and returns `{ opacityR, opacityG, opacityB, curveR, curveG, curveB }` (curves are `{gain,gamma,offset}`). Pure, deterministic, never throws.
- Per-channel search (verbatim from spec): `k` grid [0,1] step 0.02; gamma grid 61 log-spaced values on [0.1,10]; skip a `k` when `max(x_i)−min(x_i) < 1e-3`; refine around the best cell with a `k` sweep ±0.02 step 0.002 and golden-section gamma refinement (≥20 iterations); closed-form least-squares line through `(x_i, y_i^gamma)` gives gain/offset; clamp gain [0,2], offset [−0.5,0.5], gamma [0.1,10]; score = `Σ (curve(x_i) − y_i)² + 1e-5·(ln gamma)²`; keep the global best. If every `k` is inseparable, the channel keeps its `DEFAULTS` opacity and curve.
- Targets unchanged: sky `[0.25,0.40,0.75]`, foliage `[0.80,0.15,0.35]`, clouds `[0.92,0.92,0.92]`.
- Guided flow writes ONLY recipe controls; `levels` stays identity, `highlight` stays off. The neutral-anchor eyedroppers are untouched.
- UI: Red group gains slider `{ path: 'opacityR', label: 'Visible opacity', min: 0, max: 1, step: 0.01 }` (first item, mirroring the other groups); all three `curve*.gamma` sliders become `min: 0.1, max: 10`.
- Desert regression fixture (verbatim, from the field failure): sky `(0.659, 0.515, 0.101)`, foliage `(0.459, 0.183, 0.177)`, clouds `(1.000, 0.753, 0.539)`; solved controls must reproduce all nine targets within **0.02**.
- ES modules. Evergreen naming. No mocks. Tests pristine.
- Current suite baseline: 48 Vitest + 6 Playwright, all green. Do not modify `e2e/guided.spec.js`, `e2e/app.spec.js`, `e2e/anchor.spec.js`, or `e2e/orientation.spec.js` — they are behavioral and must keep passing as-is.

---

### Task 1: `opacityR` in the JS reference + defaults

**Files:**
- Modify: `src/defaults.js` (the `DEFAULTS` object)
- Modify: `src/transform.js` (`transformPixelPreAnchor`, the red line)
- Test: `test/transform.test.js` (append a describe block)

**Interfaces:**
- Consumes: existing `curve`, `cloneDefaults`, `DEFAULTS`, `transformPixel`.
- Produces: `DEFAULTS.opacityR = 0.0`; red input in `transformPixelPreAnchor` becomes `ir - params.opacityR * g` (where `g` is the source green destructured parameter).

- [ ] **Step 1: Write the failing tests — append to `test/transform.test.js`**

```js
describe('opacityR', () => {
  it('defaults to 0 in DEFAULTS', () => {
    expect(DEFAULTS.opacityR).toBe(0);
  });
  it('default 0 leaves the red channel identical to curveR(ir)', () => {
    const params = cloneDefaults();
    const out = transformPixel({ r: 0.3, g: 0.6, b: 0.4 }, params);
    expect(out.r).toBeCloseTo(curve(0.4, params.curveR), 10);
  });
  it('subtracts opacityR times source green from the red input', () => {
    const params = cloneDefaults();
    params.opacityR = 0.5;
    params.curveR = { gain: 1, gamma: 1, offset: 0 };
    const out = transformPixel({ r: 0.0, g: 0.6, b: 0.9 }, params);
    // ir − 0.5·sg = 0.9 − 0.30 = 0.6
    expect(out.r).toBeCloseTo(0.6, 10);
  });
});
```

(All names used are already imported at the top of the test file; no new imports.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/transform.test.js`
Expected: FAIL — `DEFAULTS.opacityR` is undefined; the subtraction test gets `out.r = 0.9`.

- [ ] **Step 3: Add `opacityR` to `src/defaults.js`**

In the `DEFAULTS` object, add this line directly above the `opacityG: 0.5,` line:

```js
  opacityR: 0.0,
```

- [ ] **Step 4: Update the red line in `src/transform.js`**

In `transformPixelPreAnchor`, change:

```js
    r: curve(ir, params.curveR),
```

to:

```js
    r: curve(ir - params.opacityR * g, params.curveR),
```

- [ ] **Step 5: Run the full Vitest suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all prior tests green (default 0 is identity) plus the three new tests.

- [ ] **Step 6: Commit**

```bash
git add src/defaults.js src/transform.js test/transform.test.js
git commit -m "Add opacityR visible-light subtraction to red input"
```

---

### Task 2: Shader mirror + uniform + e2e pin

**Files:**
- Modify: `src/shader.glsl` (uniform + red line)
- Modify: `src/webgl.js` (the `u` lookup object and `render`)
- Modify: `e2e/shader.spec.js` (add an `opacityR ≠ 0` param set)

**Interfaces:**
- Consumes: `DEFAULTS.opacityR` / `transformPixel` red change (Task 1); the harness `window.renderSolid(r, g, b, params)`.
- Produces: shader uniform `u_opacityR` (float), set in `render()` via `gl.uniform1f`.

- [ ] **Step 1: Update the e2e pin first (failing test)**

In `e2e/shader.spec.js`, add this function after `levelsParams()`:

```js
function opacityRParams() {
  const p = cloneDefaults();
  p.opacityR = 0.3;
  p.curveR = { gain: 1.2, gamma: 7, offset: 0.05 };
  return p;
}
```

and add this entry to `PARAM_SETS` after the `'neutral anchor levels on'` entry:

```js
  { label: 'red visible-opacity on', params: opacityRParams() },
```

- [ ] **Step 2: Run the pin to verify it fails**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/shader.spec.js`
Expected: FAIL on the `red visible-opacity on` set — the shader has no `u_opacityR`, so it ignores the subtraction while the JS reference applies it.

- [ ] **Step 3: Update `src/shader.glsl`**

Add after the `uniform float u_opacityB;` line:

```glsl
uniform float u_opacityR;
```

In `main`, change:

```glsl
  float r = applyCurve(ir, u_curveR);
```

to:

```glsl
  float r = applyCurve(ir - u_opacityR * src.g, u_curveR);
```

- [ ] **Step 4: Wire the uniform in `src/webgl.js`**

Add to the `u` object (above the `opacityG` line):

```js
    opacityR: gl.getUniformLocation(program, 'u_opacityR'),
```

Add to `render()` (above the `u.opacityG` line):

```js
    gl.uniform1f(u.opacityR, params.opacityR);
```

- [ ] **Step 5: Run the pin to verify it passes**

Run: `lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test e2e/shader.spec.js`
Expected: PASS — all four param sets match within ±2 (this also pins the wide-gamma path, gamma 7).

- [ ] **Step 6: Commit**

```bash
git add src/shader.glsl src/webgl.js e2e/shader.spec.js
git commit -m "Mirror opacityR in shader and pin it"
```

---

### Task 3: Rewrite the guided solver

**Files:**
- Rewrite: `src/guided.js` (full replacement below)
- Rewrite: `test/guided.test.js` (full replacement below)

**Interfaces:**
- Consumes: `DEFAULTS` from `./defaults.js`; tests use `transformPixel`, `cloneDefaults`.
- Produces: `export const TARGETS` (unchanged values); `export function solveGuided(sourceSamples, targets)` → `{ opacityR, opacityG, opacityB, curveR: {gain,gamma,offset}, curveG: {...}, curveB: {...} }`. The old levels-based `solveGuided` and `bisect` are REMOVED (nothing else imports them; `src/ui.js` is updated in Task 4).

Note: Task 4 updates `src/ui.js` to the new signature. After THIS task, the full Vitest suite must pass, but the app's guided click-path is temporarily inconsistent (ui.js still assigns the solver result to `params.levels`); that is expected mid-plan state, corrected in Task 4. Do not run the Playwright guided spec in this task.

- [ ] **Step 1: Replace `test/guided.test.js` with the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { solveGuided, TARGETS } from '../src/guided.js';
import { transformPixel } from '../src/transform.js';
import { cloneDefaults, DEFAULTS } from '../src/defaults.js';

// Real-world regression fixture: source samples captured from a full-spectrum
// desert photo where the levels-based solver failed (console capture, 2026-07-05).
const DESERT = {
  sky: { r: 0.659, g: 0.515, b: 0.101 },
  foliage: { r: 0.459, g: 0.183, b: 0.177 },
  clouds: { r: 1.000, g: 0.753, b: 0.539 },
};

const REGIONS = ['sky', 'foliage', 'clouds'];

function paramsWith(solved) {
  const params = cloneDefaults();
  Object.assign(params, solved);
  return params;
}

describe('solveGuided (recipe solver)', () => {
  it('reproduces all nine targets on the desert regression fixture', () => {
    const solved = solveGuided(DESERT, TARGETS);
    const params = paramsWith(solved);
    for (const region of REGIONS) {
      const out = transformPixel(DESERT[region], params);
      expect(Math.abs(out.r - TARGETS[region][0]), `${region} r`).toBeLessThan(0.02);
      expect(Math.abs(out.g - TARGETS[region][1]), `${region} g`).toBeLessThan(0.02);
      expect(Math.abs(out.b - TARGETS[region][2]), `${region} b`).toBeLessThan(0.02);
    }
  });

  it('solves a feasible synthetic case near-exactly', () => {
    const sources = {
      sky: { r: 0.7, g: 0.5, b: 0.2 },
      foliage: { r: 0.4, g: 0.2, b: 0.6 },
      clouds: { r: 0.9, g: 0.8, b: 0.5 },
    };
    const known = paramsWith({
      opacityR: 0.2, opacityG: 0.4, opacityB: 0.3,
      curveR: { gain: 1.1, gamma: 1.5, offset: 0.05 },
      curveG: { gain: 0.9, gamma: 0.8, offset: 0.1 },
      curveB: { gain: 1.2, gamma: 1.2, offset: 0.0 },
    });
    const targets = {};
    for (const region of REGIONS) {
      const out = transformPixel(sources[region], known);
      targets[region] = [out.r, out.g, out.b];
    }
    const solved = solveGuided(sources, targets);
    const params = paramsWith(solved);
    for (const region of REGIONS) {
      const out = transformPixel(sources[region], params);
      for (const [ci, ch] of [[0, 'r'], [1, 'g'], [2, 'b']]) {
        expect(Math.abs(out[ch] - targets[region][ci]), `${region} ${ch}`).toBeLessThan(1e-3);
      }
    }
  });

  it('returns params within slider ranges and never throws', () => {
    const solved = solveGuided(DESERT, TARGETS);
    for (const k of ['opacityR', 'opacityG', 'opacityB']) {
      expect(solved[k]).toBeGreaterThanOrEqual(0);
      expect(solved[k]).toBeLessThanOrEqual(1);
    }
    for (const c of ['curveR', 'curveG', 'curveB']) {
      expect(solved[c].gain).toBeGreaterThanOrEqual(0);
      expect(solved[c].gain).toBeLessThanOrEqual(2);
      expect(solved[c].gamma).toBeGreaterThanOrEqual(0.1);
      expect(solved[c].gamma).toBeLessThanOrEqual(10);
      expect(solved[c].offset).toBeGreaterThanOrEqual(-0.5);
      expect(solved[c].offset).toBeLessThanOrEqual(0.5);
      for (const v of [solved[c].gain, solved[c].gamma, solved[c].offset]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    expect(solveGuided(DESERT, TARGETS)).toEqual(solveGuided(DESERT, TARGETS));
  });

  it('keeps channel defaults when samples are inseparable', () => {
    const flat = { r: 0.5, g: 0.5, b: 0.5 };
    const solved = solveGuided({ sky: flat, foliage: flat, clouds: flat }, TARGETS);
    expect(solved.opacityR).toBe(DEFAULTS.opacityR);
    expect(solved.opacityG).toBe(DEFAULTS.opacityG);
    expect(solved.opacityB).toBe(DEFAULTS.opacityB);
    expect(solved.curveR).toEqual({ ...DEFAULTS.curveR });
    expect(solved.curveG).toEqual({ ...DEFAULTS.curveG });
    expect(solved.curveB).toEqual({ ...DEFAULTS.curveB });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/guided.test.js`
Expected: FAIL — the current `solveGuided` has the old signature/return shape (returns a levels object; `solved.opacityR` undefined).

- [ ] **Step 3: Replace `src/guided.js` entirely**

```js
import { DEFAULTS } from './defaults.js';

// Guided-auto solver: fit the recipe's own controls (IR-subtraction opacities and
// per-channel curves) so three tagged samples (sky/foliage/clouds) land on target
// aerochrome colors. Pure; deterministic; never throws.

// Target output colors (channels in [0,1]), chosen from real aerochrome.
export const TARGETS = {
  sky: [0.25, 0.40, 0.75],
  foliage: [0.80, 0.15, 0.35],
  clouds: [0.92, 0.92, 0.92],
};

const REGIONS = ['sky', 'foliage', 'clouds'];
const GAMMA_MIN = 0.1;
const GAMMA_MAX = 10;
const GAIN_MIN = 0;
const GAIN_MAX = 2;
const OFFSET_MIN = -0.5;
const OFFSET_MAX = 0.5;
const K_STEP = 0.02;
const K_REFINE_STEP = 0.002;
const GAMMA_GRID_COUNT = 61;
const SEPARATION_EPS = 1e-3;
const GAMMA_REGULARIZER = 1e-5;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function logSpace(lo, hi, count) {
  const out = [];
  const llo = Math.log(lo);
  const lhi = Math.log(hi);
  for (let i = 0; i < count; i++) out.push(Math.exp(llo + (lhi - llo) * (i / (count - 1))));
  return out;
}

const GAMMA_GRID = logSpace(GAMMA_MIN, GAMMA_MAX, GAMMA_GRID_COUNT);

// The recipe curve: clamped linear stage, then gamma. Matches curve() in transform.js.
function curveValue(x, gain, gamma, offset) {
  const linear = clamp(gain * x + offset, 0, 1);
  return Math.pow(linear, 1 / gamma);
}

// Score one (xs, gamma) candidate: for targets in (0,1), y = (gain·x + offset)^(1/gamma)
// is linear in gain/offset once gamma is fixed (y^gamma = gain·x + offset), so the
// best line through (x_i, y_i^gamma) is a closed-form least-squares fit. The residual
// is measured through the REAL clamped curve; a tiny regularizer breaks ties toward
// moderate gamma without ever trading visible target error.
function evaluate(xs, ys, gamma) {
  const zs = [Math.pow(ys[0], gamma), Math.pow(ys[1], gamma), Math.pow(ys[2], gamma)];
  const mx = (xs[0] + xs[1] + xs[2]) / 3;
  const mz = (zs[0] + zs[1] + zs[2]) / 3;
  let sxx = 0;
  let sxz = 0;
  for (let i = 0; i < 3; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxz += (xs[i] - mx) * (zs[i] - mz);
  }
  const gain = clamp(sxx > 0 ? sxz / sxx : 0, GAIN_MIN, GAIN_MAX);
  const offset = clamp(mz - gain * mx, OFFSET_MIN, OFFSET_MAX);
  let residual = 0;
  for (let i = 0; i < 3; i++) {
    const d = curveValue(xs[i], gain, gamma, offset) - ys[i];
    residual += d * d;
  }
  const lg = Math.log(gamma);
  return { score: residual + GAMMA_REGULARIZER * lg * lg, gain, offset };
}

// Golden-section minimization of f over [lo, hi].
function goldenMin(f, lo, hi, iters = 24) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
  }
  return fc < fd ? c : d;
}

function subtracted(as, bs, k) {
  const xs = [as[0] - k * bs[0], as[1] - k * bs[1], as[2] - k * bs[2]];
  const spread = Math.max(xs[0], xs[1], xs[2]) - Math.min(xs[0], xs[1], xs[2]);
  return spread < SEPARATION_EPS ? null : xs;
}

// Fit (k, gain, gamma, offset) for one channel from three (a, b, target) points.
// Returns the best candidate, or null when no k separates the samples.
function solveChannel(as, bs, ys) {
  let best = null;

  for (let i = 0; i <= 50; i++) {
    const k = i * K_STEP;
    const xs = subtracted(as, bs, k);
    if (!xs) continue;
    for (const gamma of GAMMA_GRID) {
      const e = evaluate(xs, ys, gamma);
      if (!best || e.score < best.score) {
        best = { k, gamma, gain: e.gain, offset: e.offset, score: e.score };
      }
    }
  }
  if (!best) return null;

  // Refine around the best coarse cell: fine k sweep, golden-section on gamma.
  const k0 = best.k;
  const gammaSeed = best.gamma;
  const gLo = clamp(gammaSeed / 2, GAMMA_MIN, GAMMA_MAX);
  const gHi = clamp(gammaSeed * 2, GAMMA_MIN, GAMMA_MAX);
  for (let i = -10; i <= 10; i++) {
    const k = clamp(k0 + i * K_REFINE_STEP, 0, 1);
    const xs = subtracted(as, bs, k);
    if (!xs) continue;
    const gamma = goldenMin((g) => evaluate(xs, ys, g).score, gLo, gHi);
    const e = evaluate(xs, ys, gamma);
    if (e.score < best.score) {
      best = { k, gamma, gain: e.gain, offset: e.offset, score: e.score };
    }
  }
  return best;
}

// Per-channel inputs: red fits ir − k·green_src; green/blue fit their source
// channel minus k·ir (the recipe's IR subtraction).
const CHANNELS = [
  { curve: 'curveR', opacity: 'opacityR', a: (s) => s.b, b: (s) => s.g, ti: 0 },
  { curve: 'curveG', opacity: 'opacityG', a: (s) => s.r, b: (s) => s.b, ti: 1 },
  { curve: 'curveB', opacity: 'opacityB', a: (s) => s.g, b: (s) => s.b, ti: 2 },
];

// Fit recipe controls from three raw source samples toward the targets.
export function solveGuided(sourceSamples, targets) {
  const solved = {};
  for (const ch of CHANNELS) {
    const as = REGIONS.map((region) => ch.a(sourceSamples[region]));
    const bs = REGIONS.map((region) => ch.b(sourceSamples[region]));
    const ys = REGIONS.map((region) => targets[region][ch.ti]);
    const fit = solveChannel(as, bs, ys);
    if (fit) {
      solved[ch.opacity] = fit.k;
      solved[ch.curve] = { gain: fit.gain, gamma: fit.gamma, offset: fit.offset };
    } else {
      solved[ch.opacity] = DEFAULTS[ch.opacity];
      solved[ch.curve] = { ...DEFAULTS[ch.curve] };
    }
  }
  return solved;
}
```

- [ ] **Step 4: Run the guided tests to verify they pass**

Run: `npx vitest run test/guided.test.js`
Expected: PASS — desert fixture within 0.02, synthetic within 1e-3, ranges, determinism, inseparable fallback.

- [ ] **Step 5: Run the full Vitest suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/guided.js test/guided.test.js
git commit -m "Rewrite guided solver to fit recipe controls"
```

---

### Task 4: UI wiring — new slider, wider gammas, solver hookup

**Files:**
- Modify: `src/ui.js` (`CONTROLS` table; `solveGuidedFromSamples`)

**Interfaces:**
- Consumes: `solveGuided`/`TARGETS` (Task 3 signature: raw samples in, recipe controls out); existing `cloneDefaults`, `syncControlsFromParams`, `render`, `guidedSamples`.
- Produces: the working end-to-end guided flow on the new solver.

- [ ] **Step 1: Update the `CONTROLS` table in `src/ui.js`**

Replace the `'Red output (IR)'` group entry with (adds the opacity slider first, widens gamma):

```js
  { group: 'Red output (IR)', items: [
    { path: 'opacityR', label: 'Visible opacity', min: 0, max: 1, step: 0.01 },
    { path: 'curveR.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveR.gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.01 },
    { path: 'curveR.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
```

In the green and blue groups, change only the gamma lines to:

```js
    { path: 'curveG.gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.01 },
```

```js
    { path: 'curveB.gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.01 },
```

- [ ] **Step 2: Rewire `solveGuidedFromSamples`**

Replace the whole function with:

```js
  function solveGuidedFromSamples() {
    params = cloneDefaults();
    Object.assign(params, solveGuided(guidedSamples, TARGETS));
    syncControlsFromParams();
    render();
  }
```

(`solveGuided` now takes the raw source samples directly; the guided path no longer
calls `transformPixelPreAnchor`, which remains in use by the eyedropper path below it.
Levels stay at the `cloneDefaults()` identity.)

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Run the entire suite together**

Run: `npx vitest run && (lsof -ti tcp:5173 | xargs kill -9 2>/dev/null; npx playwright test)`
Expected: Vitest all green; all Playwright specs green UNCHANGED — including `e2e/guided.spec.js` (the stripe fixture is solvable by the new solver; foliage still lands redder-than-default and red-dominant) and `e2e/app.spec.js` (group count is still 4; only slider rows changed).

- [ ] **Step 5: Manual sanity note for the reviewer/report**

Record in the task report: after this task, the guided solve writes `opacityR/G/B` and the three curves into the visible sliders (check `syncControlsFromParams` displays them, e.g. a gamma above 5 now shows on the widened slider), and `levels` remains identity after a guided solve.

- [ ] **Step 6: Commit**

```bash
git add src/ui.js
git commit -m "Wire guided flow to recipe solver with opacityR slider"
```

---

## Self-Review

**Spec coverage:**
- Recipe change `R_out = curveR(ir − opacityR·sg)` + default 0 back-compat → Task 1 (JS) + Task 2 (GLSL/uniform), pinned by the Task 2 e2e set (which also exercises gamma 7 > old cap). ✓
- Gamma sliders 0.1–10 + "Visible opacity" slider (first item, red group) → Task 4. ✓
- Solver: raw source samples in; k grid 0.02 / 61 log gammas / separation guard 1e-3 / refine k ±0.02 step 0.002 + golden ≥20 (24 iters) / closed-form LS gain-offset / clamps to slider ranges / score with 1e-5 regularizer / global best / per-channel DEFAULTS fallback → Task 3 `solveChannel`/`evaluate`/`goldenMin`. ✓
- Guided flow writes only recipe controls; levels identity; highlight off; raw samples (no `transformPixelPreAnchor` in guided path) → Task 4 `solveGuidedFromSamples` (`cloneDefaults()` + `Object.assign`). ✓
- Targets unchanged → Task 3 `TARGETS`. ✓
- Desert regression fixture within 0.02; synthetic ≤1e-3; ranges; determinism; inseparable fallback → Task 3 tests. ✓
- Old `solveGuided`/`bisect` removed → Task 3 full-file replacement. ✓
- Existing behavioral e2e specs untouched and still green → Task 4 Step 4. ✓

**Placeholder scan:** none; all code steps show complete code.

**Type consistency:** `solveGuided(sourceSamples, targets)` return keys (`opacityR/G/B`, `curveR/G/B` as `{gain,gamma,offset}`) match `DEFAULTS`' top-level shape, so Task 4's `Object.assign(params, solved)` lands each control at its param path and `syncControlsFromParams` picks them up via the Task 4 `CONTROLS` paths (`opacityR`, `curve*.{gain,gamma,offset}`). The Task 3 test's `paramsWith` mirrors that same assignment. Channel input pairs in `CHANNELS` match the recipe table in the spec (red: `s.b`/`s.g`; green: `s.r`/`s.b`; blue: `s.g`/`s.b`) and the `ti` indices match target array order. ✓

**Feasibility (verified analytically against the desert fixture):** red solves near `k≈0.2, gamma≈7.2, gain≈1.4, offset≈0.003`; green near `k=0, gamma≈0.8, gain≈1.32, offset≈−0.39`; blue near `k=0, gamma≈2.3, gain≈1.29, offset≈−0.14` — all within clamps, so the 0.02 tolerance has margin. The stripe e2e's red channel solves at `k=0, gamma≈6` keeping foliage ≈204 (> default 128 + 30). ✓
