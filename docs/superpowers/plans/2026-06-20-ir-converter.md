# IR / Aerochrome Image Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-free browser app that converts full-spectrum/yellow-filter photos into false-color IRG images using a WebGL shader, with live gain/gamma/offset and IR-subtraction controls and localStorage presets.

**Architecture:** Vite + Vitest frontend. The per-pixel transform math lives in pure JS (`src/transform.js`, unit-tested) and is mirrored in a GLSL fragment shader (`src/shader.glsl`). A Playwright e2e test renders the real shader against known solid colors and asserts it matches the JS reference, pinning the two implementations together.

**Tech Stack:** Vite, Vitest (+ jsdom), Playwright, WebGL, vanilla JS/DOM.

## Global Constraints

- Pure frontend, no backend process; no image ever leaves the browser.
- Node ≥ 20 (dev environment is Node 24, npm 11).
- ES modules throughout (`"type": "module"`).
- TDD: write the failing test first, then minimal implementation.
- Transform math defined once as the JS reference (`src/transform.js`); `src/shader.glsl` must mirror it exactly.
- Curve definition (verbatim): `curve(x; gain, gamma, offset) = clamp(gain*x + offset, 0, 1) ^ (1/gamma)`.
- Channel mapping (verbatim): `R_out = curveR(ir)`, `G_out = curveG(sr - opacityG*ir)`, `B_out = curveB(sg - opacityB*ir)`, where `ir = sb`.
- Default params: `opacityG=0.5`, `opacityB=0.5`, `curveR={gain:1.0,gamma:1.0,offset:0.0}`, `curveG={gain:0.95,gamma:1.0,offset:0.0}`, `curveB={gain:1.05,gamma:1.0,offset:0.02}`.
- Naming is evergreen — no "new"/"improved"/"enhanced" identifiers.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `vitest.config.js`
- Create: `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm test` (Vitest) and `npm run dev` (Vite). Vitest globals (`describe`/`it`/`expect`) enabled.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ir-converter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "@playwright/test": "^1.48.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: { outDir: 'dist' },
});
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Write the smoke test `test/smoke.test.js`**

```js
import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install dependencies and run the smoke test**

Run: `npm install && npm test`
Expected: install succeeds; Vitest reports `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js vitest.config.js test/smoke.test.js
git commit -m "Scaffold Vite + Vitest project"
```

---

### Task 2: Transform math and defaults

**Files:**
- Create: `src/defaults.js`
- Create: `src/transform.js`
- Test: `test/transform.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/defaults.js`: `export const DEFAULTS` (frozen param object as specified in Global Constraints); `export function cloneDefaults()` → deep copy of `DEFAULTS`.
  - `src/transform.js`: `export function clamp01(x): number`; `export function curve(x, {gain, gamma, offset}): number`; `export function transformPixel({r, g, b}, params): {r, g, b}` — all channels in `[0,1]`. `params` has the same shape as `DEFAULTS`.

- [ ] **Step 1: Write the failing test `test/transform.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { clamp01, curve, transformPixel } from '../src/transform.js';
import { DEFAULTS, cloneDefaults } from '../src/defaults.js';

const IDENTITY = { gain: 1, gamma: 1, offset: 0 };

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBeCloseTo(0.4, 10);
  });
});

describe('curve', () => {
  it('is identity for gain 1, gamma 1, offset 0', () => {
    expect(curve(0.3, IDENTITY)).toBeCloseTo(0.3, 10);
  });
  it('applies gain and offset before gamma, clamping the linear stage', () => {
    // gain*x+offset = 2*0.6+0 = 1.2 -> clamp 1 -> 1^(1/1) = 1
    expect(curve(0.6, { gain: 2, gamma: 1, offset: 0 })).toBe(1);
    // negative linear stage clamps to 0
    expect(curve(0.1, { gain: 1, gamma: 1, offset: -0.5 })).toBe(0);
  });
  it('applies gamma after the linear stage', () => {
    // clamp(0.25) ^ (1/2) = 0.5
    expect(curve(0.25, { gain: 1, gamma: 2, offset: 0 })).toBeCloseTo(0.5, 10);
  });
});

describe('transformPixel', () => {
  it('maps IR (blue) to the red output channel', () => {
    const out = transformPixel({ r: 0.2, g: 0.4, b: 0.7 }, {
      ...cloneDefaults(), curveR: IDENTITY,
    });
    expect(out.r).toBeCloseTo(0.7, 10);
  });
  it('subtracts IR from the source red for the green output', () => {
    const out = transformPixel({ r: 0.8, g: 0.0, b: 0.4 }, {
      ...cloneDefaults(), opacityG: 0.5, curveG: IDENTITY,
    });
    // 0.8 - 0.5*0.4 = 0.6
    expect(out.g).toBeCloseTo(0.6, 10);
  });
  it('subtracts IR from the source green for the blue output', () => {
    const out = transformPixel({ r: 0.0, g: 0.9, b: 0.4 }, {
      ...cloneDefaults(), opacityB: 0.5, curveB: IDENTITY,
    });
    // 0.9 - 0.5*0.4 = 0.7
    expect(out.b).toBeCloseTo(0.7, 10);
  });
  it('keeps all outputs within [0,1]', () => {
    const out = transformPixel({ r: 1, g: 1, b: 0 }, cloneDefaults());
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('DEFAULTS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULTS.opacityG).toBe(0.5);
    expect(DEFAULTS.opacityB).toBe(0.5);
    expect(DEFAULTS.curveR).toEqual({ gain: 1.0, gamma: 1.0, offset: 0.0 });
    expect(DEFAULTS.curveG).toEqual({ gain: 0.95, gamma: 1.0, offset: 0.0 });
    expect(DEFAULTS.curveB).toEqual({ gain: 1.05, gamma: 1.0, offset: 0.02 });
  });
  it('cloneDefaults returns an independent copy', () => {
    const a = cloneDefaults();
    a.curveR.gain = 99;
    expect(DEFAULTS.curveR.gain).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/transform.test.js`
Expected: FAIL — cannot resolve `../src/transform.js` / `../src/defaults.js`.

- [ ] **Step 3: Implement `src/defaults.js`**

```js
// Canonical default parameters, shared by the UI, presets, and tests.
export const DEFAULTS = Object.freeze({
  opacityG: 0.5,
  opacityB: 0.5,
  curveR: Object.freeze({ gain: 1.0, gamma: 1.0, offset: 0.0 }),
  curveG: Object.freeze({ gain: 0.95, gamma: 1.0, offset: 0.0 }),
  curveB: Object.freeze({ gain: 1.05, gamma: 1.0, offset: 0.02 }),
});

// Deep, mutable copy of DEFAULTS for use as live editable state.
export function cloneDefaults() {
  return structuredClone(DEFAULTS);
}
```

- [ ] **Step 4: Implement `src/transform.js`**

```js
// Pure reference implementation of the IRG transform. Mirrored in src/shader.glsl.

export function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Per-channel curve: linear gain/offset (clamped), then gamma.
export function curve(x, { gain, gamma, offset }) {
  const linear = clamp01(gain * x + offset);
  return Math.pow(linear, 1 / gamma);
}

// pixel channels are normalized to [0,1]; blue is the IR signal.
export function transformPixel({ r, g, b }, params) {
  const ir = b;
  return {
    r: curve(ir, params.curveR),
    g: curve(r - params.opacityG * ir, params.curveG),
    b: curve(g - params.opacityB * ir, params.curveB),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/transform.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/defaults.js src/transform.js test/transform.test.js
git commit -m "Add transform math and default parameters"
```

---

### Task 3: Presets (localStorage persistence)

**Files:**
- Create: `src/presets.js`
- Test: `test/presets.test.js`

**Interfaces:**
- Consumes: nothing (operates on any Storage-like object; defaults to `localStorage`).
- Produces:
  - `export function loadPresets(storage = localStorage): Record<string, params>` — returns `{}` for missing/malformed data.
  - `export function savePreset(name, params, storage = localStorage): presetsMap` — throws `Error('Preset name required')` for empty/whitespace name.
  - `export function deletePreset(name, storage = localStorage): presetsMap`.

- [ ] **Step 1: Write the failing test `test/presets.test.js`**

```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPresets, savePreset, deletePreset } from '../src/presets.js';
import { cloneDefaults } from '../src/defaults.js';

beforeEach(() => localStorage.clear());

describe('presets', () => {
  it('returns an empty object when nothing is stored', () => {
    expect(loadPresets()).toEqual({});
  });
  it('saves and loads a preset round-trip', () => {
    const params = cloneDefaults();
    params.opacityG = 0.25;
    savePreset('moody', params);
    expect(loadPresets()['moody'].opacityG).toBe(0.25);
  });
  it('overwrites a preset with the same name', () => {
    savePreset('x', { ...cloneDefaults(), opacityG: 0.1 });
    savePreset('x', { ...cloneDefaults(), opacityG: 0.9 });
    expect(loadPresets()['x'].opacityG).toBe(0.9);
  });
  it('rejects an empty or whitespace name', () => {
    expect(() => savePreset('', cloneDefaults())).toThrow('Preset name required');
    expect(() => savePreset('   ', cloneDefaults())).toThrow('Preset name required');
  });
  it('deletes a preset', () => {
    savePreset('gone', cloneDefaults());
    deletePreset('gone');
    expect(loadPresets()['gone']).toBeUndefined();
  });
  it('returns an empty object for malformed stored data', () => {
    localStorage.setItem('ir-converter-presets', '{not json');
    expect(loadPresets()).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/presets.test.js`
Expected: FAIL — cannot resolve `../src/presets.js`.

- [ ] **Step 3: Implement `src/presets.js`**

```js
const KEY = 'ir-converter-presets';

export function loadPresets(storage = localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePreset(name, params, storage = localStorage) {
  if (!name || !name.trim()) throw new Error('Preset name required');
  const presets = loadPresets(storage);
  presets[name] = params;
  storage.setItem(KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(name, storage = localStorage) {
  const presets = loadPresets(storage);
  delete presets[name];
  storage.setItem(KEY, JSON.stringify(presets));
  return presets;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/presets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presets.js test/presets.test.js
git commit -m "Add localStorage preset persistence"
```

---

### Task 4: WebGL renderer and shader

**Files:**
- Create: `src/shader.glsl`
- Create: `src/webgl.js`

**Interfaces:**
- Consumes: `src/shader.glsl` (imported as raw text via Vite `?raw`).
- Produces: `src/webgl.js` → `export function createRenderer(canvas): { setImage(source), render(params), readPixels(), gl }`.
  - `setImage(source)` uploads a texture (source is any `texImage2D`-compatible object with `.width`/`.height`: `ImageBitmap`, `HTMLImageElement`, `HTMLCanvasElement`) and sizes `canvas` to it.
  - `render(params)` sets uniforms from a `DEFAULTS`-shaped param object and draws.
  - `readPixels()` → `{ data: Uint8Array, width, height }` (RGBA, used by the e2e test).
  - `createRenderer` throws `Error('WebGL not supported')` if no context.

> No unit test in this task: WebGL needs a real GL context, which Vitest's jsdom does not provide. The shader and renderer are verified end-to-end in Task 6, which pins the shader output to the `transform.js` reference. This is an intentional, documented coverage boundary, not a skipped layer.

- [ ] **Step 1: Create the fragment shader `src/shader.glsl`**

```glsl
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
```

- [ ] **Step 2: Create the renderer `src/webgl.js`**

```js
import fragmentSource from './shader.glsl?raw';

const VERTEX_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL not supported');

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const u = {
    opacityG: gl.getUniformLocation(program, 'u_opacityG'),
    opacityB: gl.getUniformLocation(program, 'u_opacityB'),
    curveR: gl.getUniformLocation(program, 'u_curveR'),
    curveG: gl.getUniformLocation(program, 'u_curveG'),
    curveB: gl.getUniformLocation(program, 'u_curveB'),
  };

  let width = 0;
  let height = 0;

  function setImage(source) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    width = source.width;
    height = source.height;
    canvas.width = width;
    canvas.height = height;
  }

  function render(params) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(u.opacityG, params.opacityG);
    gl.uniform1f(u.opacityB, params.opacityB);
    gl.uniform3f(u.curveR, params.curveR.gain, params.curveR.gamma, params.curveR.offset);
    gl.uniform3f(u.curveG, params.curveG.gain, params.curveG.gamma, params.curveG.offset);
    gl.uniform3f(u.curveB, params.curveB.gain, params.curveB.gamma, params.curveB.offset);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function readPixels() {
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, width, height };
  }

  return { setImage, render, readPixels, gl };
}
```

- [ ] **Step 3: Verify the module imports cleanly (build check)**

Run: `npx vite build`
Expected: build succeeds (confirms `?raw` import and syntax are valid). The renderer is exercised at runtime in Tasks 5–6.

- [ ] **Step 4: Commit**

```bash
git add src/shader.glsl src/webgl.js
git commit -m "Add WebGL renderer and IRG fragment shader"
```

---

### Task 5: App UI (index.html + ui.js)

**Files:**
- Create: `index.html`
- Create: `src/ui.js`

**Interfaces:**
- Consumes: `createRenderer` (Task 4), `cloneDefaults` / `DEFAULTS` (Task 2), `loadPresets` / `savePreset` / `deletePreset` (Task 3).
- Produces: `src/ui.js` → `export function init()` that wires the DOM, and self-invokes on load. Drives image loading (file picker + drag-drop), the control sliders, Reset, PNG export, and the presets UI.

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IR / Aerochrome Converter</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; background: #1b1b1f; color: #eee; }
      h1 { font-size: 1.2rem; }
      #drop-zone { border: 2px dashed #555; border-radius: 8px; padding: 1rem; text-align: center; margin-bottom: 0.5rem; }
      #drop-zone.dragover { border-color: #6cf; background: #25303a; }
      .error { color: #f88; }
      main { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
      .images { display: flex; gap: 1rem; flex: 1 1 480px; }
      figure { margin: 0; flex: 1; }
      figcaption { font-size: 0.8rem; margin-bottom: 0.25rem; color: #aaa; }
      canvas { width: 100%; height: auto; background: #000; border: 1px solid #333; }
      #controls { flex: 0 0 280px; }
      .group { border: 1px solid #333; border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; }
      .group h2 { font-size: 0.85rem; margin: 0 0 0.5rem; color: #9cf; }
      .control { display: grid; grid-template-columns: 70px 1fr 46px; gap: 0.4rem; align-items: center; font-size: 0.78rem; margin-bottom: 0.3rem; }
      .control output { text-align: right; font-variant-numeric: tabular-nums; }
      button { background: #2a3440; color: #eee; border: 1px solid #456; border-radius: 5px; padding: 0.35rem 0.6rem; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: default; }
      .presets { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
      .presets input, .presets select { background: #11151a; color: #eee; border: 1px solid #456; border-radius: 5px; padding: 0.3rem; }
    </style>
  </head>
  <body>
    <h1>IR / Aerochrome Converter</h1>
    <div id="drop-zone">
      <input type="file" id="file-input" accept="image/*" />
      <span>or drag &amp; drop an image</span>
    </div>
    <p id="error" class="error" hidden></p>
    <main>
      <section class="images">
        <figure><figcaption>Original</figcaption><canvas id="source-canvas"></canvas></figure>
        <figure><figcaption>Result</figcaption><canvas id="result-canvas"></canvas></figure>
      </section>
      <aside id="controls">
        <div id="control-groups"></div>
        <button id="reset">Reset</button>
        <button id="export" disabled>Export PNG</button>
        <div class="presets">
          <input id="preset-name" type="text" placeholder="Preset name" />
          <button id="preset-save">Save</button>
          <select id="preset-list"><option value="">Load preset…</option></select>
          <button id="preset-delete">Delete</button>
        </div>
      </aside>
    </main>
    <script type="module" src="/src/ui.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/ui.js`**

```js
import { createRenderer } from './webgl.js';
import { cloneDefaults } from './defaults.js';
import { loadPresets, savePreset, deletePreset } from './presets.js';

const CONTROLS = [
  { group: 'Red output (IR)', items: [
    { path: 'curveR.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveR.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveR.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { group: 'Green output (red − IR)', items: [
    { path: 'opacityG', label: 'IR opacity', min: 0, max: 1, step: 0.01 },
    { path: 'curveG.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveG.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveG.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { group: 'Blue output (green − IR)', items: [
    { path: 'opacityB', label: 'IR opacity', min: 0, max: 1, step: 0.01 },
    { path: 'curveB.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveB.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveB.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

export function init() {
  const $ = (id) => document.getElementById(id);
  const errorEl = $('error');
  const resultCanvas = $('result-canvas');
  const sourceCanvas = $('source-canvas');
  const exportBtn = $('export');

  let renderer;
  try {
    renderer = createRenderer(resultCanvas);
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent = 'WebGL is not available in this browser.';
    return;
  }

  let params = cloneDefaults();
  let hasImage = false;

  function showError(msg) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }
  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function render() {
    if (hasImage) renderer.render(params);
  }

  // --- Build control sliders ---
  const inputsByPath = new Map();
  const outputsByPath = new Map();
  const groupsEl = $('control-groups');
  for (const group of CONTROLS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'group';
    const title = document.createElement('h2');
    title.textContent = group.group;
    groupEl.appendChild(title);
    for (const item of group.items) {
      const row = document.createElement('label');
      row.className = 'control';
      const name = document.createElement('span');
      name.textContent = item.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step;
      const out = document.createElement('output');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setPath(params, item.path, v);
        out.textContent = v.toFixed(2);
        render();
      });
      row.append(name, input, out);
      groupEl.appendChild(row);
      inputsByPath.set(item.path, input);
      outputsByPath.set(item.path, out);
    }
    groupsEl.appendChild(groupEl);
  }

  function syncControlsFromParams() {
    for (const [path, input] of inputsByPath) {
      const v = getPath(params, path);
      input.value = v;
      outputsByPath.get(path).textContent = Number(v).toFixed(2);
    }
  }
  syncControlsFromParams();

  // --- Image loading ---
  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showError('Please choose an image file.');
      return;
    }
    clearError();
    try {
      const bitmap = await createImageBitmap(file);
      renderer.setImage(bitmap);
      sourceCanvas.width = bitmap.width;
      sourceCanvas.height = bitmap.height;
      sourceCanvas.getContext('2d').drawImage(bitmap, 0, 0);
      hasImage = true;
      exportBtn.disabled = false;
      render();
    } catch (e) {
      showError('Could not load that image.');
    }
  }

  $('file-input').addEventListener('change', (e) => loadFile(e.target.files[0]));

  const dropZone = $('drop-zone');
  ['dragover', 'dragenter'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  // --- Reset ---
  $('reset').addEventListener('click', () => {
    params = cloneDefaults();
    syncControlsFromParams();
    render();
  });

  // --- Export ---
  exportBtn.addEventListener('click', () => {
    render(); // ensure current frame is in the buffer
    resultCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'irg.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  // --- Presets ---
  const presetList = $('preset-list');
  function refreshPresetList() {
    const presets = loadPresets();
    presetList.innerHTML = '<option value="">Load preset…</option>';
    for (const name of Object.keys(presets)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      presetList.appendChild(opt);
    }
  }
  refreshPresetList();

  $('preset-save').addEventListener('click', () => {
    const name = $('preset-name').value;
    try {
      savePreset(name, structuredClone(params));
      clearError();
      refreshPresetList();
    } catch (e) {
      showError(e.message);
    }
  });

  presetList.addEventListener('change', () => {
    const name = presetList.value;
    if (!name) return;
    const preset = loadPresets()[name];
    if (preset) {
      params = structuredClone(preset);
      syncControlsFromParams();
      render();
    }
  });

  $('preset-delete').addEventListener('click', () => {
    const name = presetList.value || $('preset-name').value;
    if (!name) return;
    deletePreset(name);
    refreshPresetList();
  });
}

if (typeof document !== 'undefined') {
  init();
}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, open the printed URL, load `~/src/_DSC3489.jpg`.
Expected: original shows left, false-color IRG result shows right; moving any slider updates the result live; Reset restores defaults; Export downloads `irg.png`; saving a preset then selecting it from the dropdown re-applies the settings. (This is a manual smoke; automated UI coverage lands in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui.js
git commit -m "Add app UI: image load, controls, export, presets"
```

---

### Task 6: Playwright e2e — pin shader to JS reference + app smoke

**Files:**
- Create: `playwright.config.js`
- Create: `e2e/harness.html`
- Create: `e2e/harness.js`
- Create: `e2e/shader.spec.js`
- Create: `e2e/app.spec.js`
- Modify: `package.json` (already has `test:e2e`; no change needed if present)

**Interfaces:**
- Consumes: `createRenderer` (Task 4), `transformPixel` + `cloneDefaults` (Task 2).
- Produces: a Playwright suite asserting the GLSL shader matches `transform.js` for known solid colors, plus an app load smoke test.

- [ ] **Step 1: Install the Playwright browser**

Run: `npx playwright install chromium`
Expected: Chromium downloads successfully.

- [ ] **Step 2: Create `playwright.config.js`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
  use: { baseURL: 'http://localhost:5173' },
});
```

- [ ] **Step 3: Create the harness page `e2e/harness.html`**

```html
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8" /><title>harness</title></head>
  <body>
    <canvas id="c"></canvas>
    <script type="module" src="/e2e/harness.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create the harness script `e2e/harness.js`**

```js
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
```

- [ ] **Step 5: Write the shader pin test `e2e/shader.spec.js`**

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
```

- [ ] **Step 6: Write the app smoke test `e2e/app.spec.js`**

```js
import { test, expect } from '@playwright/test';

test('app loads without console errors and shows controls', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#file-input')).toBeVisible();
  await expect(page.locator('#control-groups .group')).toHaveCount(3);
  await expect(page.locator('#export')).toBeDisabled();
  expect(errors, errors.join('\n')).toEqual([]);
});
```

- [ ] **Step 7: Run the e2e suite**

Run: `npx playwright test`
Expected: both specs PASS (Vite dev server auto-starts; shader matches reference within ±2; app loads clean).

- [ ] **Step 8: Commit**

```bash
git add playwright.config.js e2e/
git commit -m "Add Playwright e2e: shader-vs-reference pin and app smoke"
```

---

## Self-Review

**Spec coverage:**
- Core transform / curve / channel mapping → Task 2 (JS) + Task 4 (GLSL), pinned by Task 6. ✓
- Controls (opacityG/B, per-channel gain/gamma/offset) + defaults + Reset → Task 2 defaults, Task 5 UI. ✓
- WebGL real-time render, texture uploaded once → Task 4. ✓
- Input + output side by side → Task 5 (`source-canvas`, `result-canvas`). ✓
- File picker + drag-drop → Task 5. ✓
- PNG export at full resolution → Task 5 (`toBlob`, canvas sized to source). ✓
- Presets in localStorage (save/load/delete) → Task 3 + Task 5 UI. ✓
- Error handling (non-image, WebGL unavailable, empty preset name, export-before-image) → Task 5 + Task 3. ✓
- Testing: unit (Task 2), integration/jsdom (Task 3), e2e/Playwright (Task 6). ✓
- Out-of-scope items (channel previews, histograms, spline editor) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders; every code step shows full code. ✓

**Type consistency:** `createRenderer` → `{setImage, render, readPixels, gl}` used consistently in Tasks 4/5/6. `transformPixel`, `curve`, `clamp01`, `cloneDefaults`, `DEFAULTS`, `loadPresets`/`savePreset`/`deletePreset` signatures match across tasks. Param shape (`opacityG`, `opacityB`, `curveR/G/B.{gain,gamma,offset}`) identical in defaults, transform, shader uniforms, and UI control paths. ✓
