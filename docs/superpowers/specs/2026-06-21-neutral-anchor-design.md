# Neutral Anchor (Eyedropper White Balance) — Design

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Builds on:** 2026-06-20-ir-converter-design.md, 2026-06-20-highlight-desaturation-design.md

## Purpose

Let the user click a spot in the converted image and declare what it *should* be —
black, neutral gray, or white — and have the app anchor to that, removing color
casts and pinning the tonal range. This is an output-side, per-channel "levels"
operation driven by three eyedroppers, exactly like the black/gray/white pickers in
a Levels dialog. It is **off by default** (identity) and one-shot: clicking sets the
anchor; a Reset clears it. (Maintaining the anchor as a constraint while other
sliders move, and locking controls, is explicitly a future iteration.)

## The neutral-anchor stage (math)

A new **final** pipeline stage, applied per channel to the assembled output RGB
*after* the highlight-desaturation stage. New param block:

```
levels: {
  black: [0, 0, 0],
  white: [1, 1, 1],
  gamma: [1, 1, 1],
}
```

Per channel `c` (with `in_c` the stage input in [0,1]):

```
n_c   = clamp((in_c - black_c) / max(white_c - black_c, 1e-5), 0, 1)
out_c = pow(n_c, 1 / gamma_c)
```

- Defaults `black=0, white=1, gamma=1` make the stage an exact identity, so existing
  output and tests are unchanged until the user anchors.
- `max(white_c - black_c, 1e-5)` guards divide-by-zero / inverted points, consistent
  with the existing smoothstep guard.
- Output stays in [0,1]: `n_c` is clamped to [0,1] and `pow` of a value in [0,1] by a
  positive exponent stays in [0,1].

The stage is mirrored byte-for-byte in `src/transform.js` (`applyLevels`) and
`src/shader.glsl` (`applyLevels` over three `vec3` uniforms), pinned by the e2e
shader test.

## Pipeline order

```
source -> channel transform (curveR/G/B) -> highlight desat -> neutral levels (anchor) -> output
```

The anchor is the LAST stage, so a pixel the user anchors to neutral is truly neutral
in the final, displayed/exported image (nothing downstream re-introduces a cast).

## The eyedroppers

Three buttons — **Pick black**, **Pick gray**, **Pick white** — each arm a sampling
mode (the Result canvas shows a crosshair cursor). The user then clicks the **Result**
image.

### Sampling

1. The click's client coordinates map to a source pixel via the Result canvas's
   bounding rect and intrinsic dimensions:
   ```
   x = floor((clientX - rect.left) / rect.width  * canvas.width)
   y = floor((clientY - rect.top)  / rect.height * canvas.height)
   ```
   clamped to `[0, width-1]` / `[0, height-1]`. (Result and source canvases share the
   source's intrinsic dimensions.)
2. The sampled color is the **average of a 3×3 block** around `(x,y)` (clamped to image
   bounds) read from the existing source 2D canvas via `getImageData`, normalized to
   [0,1]. Averaging reduces sensor-noise sensitivity.
3. The value **feeding the anchor stage** at that pixel is computed in JS with
   `transformPixelPreAnchor(sampledSourceColor, params)` — the channel transform plus
   highlight desat, WITHOUT the levels stage. This reuses the reference math and needs
   no GPU readback.

### Solve

`solveAnchor(mode, value, currentLevels)` is a pure function returning an updated
`levels` object (it does not mutate its input):

- **white**: `white = [value.r, value.g, value.b]` — those channels now map to 1.
- **black**: `black = [value.r, value.g, value.b]` — those channels now map to 0.
- **gray**: with the current black/white, compute the normalized channels
  `n_c = clamp((value_c - black_c) / max(white_c - black_c, 1e-5), 0, 1)` and a target
  `T = (n_r + n_g + n_b) / 3`. Set per-channel `gamma_c = ln(n_c) / ln(T)` so each
  channel maps to `T` (converging to a neutral gray at roughly the sampled brightness),
  with guards:
  - If `T <= 0` or `T >= 1`, or `n_c <= 0` or `n_c >= 1`, or `n_c == T`: leave
    `gamma_c = 1` (no change for that channel).
  - Clamp each solved `gamma_c` to `[0.1, 10]` to avoid extreme values.

After any eyedropper action the app re-renders. **Reset anchor** sets `levels` back to
the identity default and re-renders.

## File changes

- `src/transform.js`
  - Split the current `transformPixel` body into `transformPixelPreAnchor({r,g,b}, params)`
    = channel transform + `applyHighlightDesat` (no levels).
  - Add `applyLevels({r,g,b}, { black, white, gamma })`.
  - Add `solveAnchor(mode, { r, g, b }, currentLevels)` returning a new `levels` object;
    `mode` is one of `'black' | 'gray' | 'white'`.
  - `transformPixel(px, params)` = `applyLevels(transformPixelPreAnchor(px, params), params.levels)`.
- `src/defaults.js` — add the `levels` identity block to `DEFAULTS`.
- `src/shader.glsl` — add `uniform vec3 u_levelsBlack, u_levelsWhite, u_levelsGamma;`
  and `applyLevels`; apply it as the final step in `main` (after highlight desat,
  before `gl_FragColor`).
- `src/webgl.js` — look up the three uniforms and set them in `render()` via
  `gl.uniform3f`.
- `src/ui.js`
  - Add an "Anchor" group: three eyedropper buttons (`black`/`gray`/`white`) and a
    "Reset anchor" button.
  - Add a pure `canvasPixelFromEvent(event, canvas)` helper for coordinate mapping.
  - Add a result-canvas click handler that, when a mode is armed, samples (3×3 average
    from the source canvas), computes the pre-anchor value, calls `solveAnchor`, updates
    `params.levels`, re-renders, and disarms the mode.
  - Eyedropper buttons are disabled until an image is loaded (same gate as Export).

Presets need no new persistence code: `levels` serializes through the existing
save/load, and `withDefaults` backfills it for presets saved before this feature.

## UI

A new **"Anchor"** group in the control panel:

- Buttons: **Pick black**, **Pick gray**, **Pick white**, **Reset anchor**.
- Arming a pick button sets a crosshair cursor on the Result canvas and visually marks
  the active mode; clicking the canvas samples and disarms.
- No per-channel sliders for the levels values in v1 (one-shot; existing channel
  sliders remain for manual tweaks).

## Error handling

- Eyedropper buttons disabled until an image is loaded.
- A click on the Result canvas with no mode armed does nothing.
- Coordinate mapping clamps to valid pixel bounds, so edge clicks are safe.
- The divide-by-zero / inverted-point guard keeps the levels map finite for any
  sampled values; the gamma guards keep `solveAnchor` finite for degenerate samples
  (pure black/white pixels, already-neutral grays).

## Testing

Built TDD; default identity means existing tests stay green.

- **Unit (`test/transform.test.js`):**
  - `applyLevels` with defaults is identity for any pixel.
  - `applyLevels` maps `black`→0 and `white`→1 per channel; output stays in [0,1].
  - `transformPixelPreAnchor` excludes the levels stage (equals the old transform output);
    `transformPixel` with default `levels` is unchanged from current behavior.
  - `solveAnchor('white', v, levels)` sets `white = v`; `solveAnchor('black', v, levels)`
    sets `black = v`; both return a new object (input not mutated).
  - `solveAnchor('gray', v, levels)` yields gammas such that applying the resulting levels
    to `v` produces equal channels (neutral), within tolerance.
  - `solveAnchor` gray guards: a pure-black, pure-white, or already-neutral sample leaves
    gammas at 1 (no NaN/Infinity).
- **Unit (`test/ui-coords.test.js`, jsdom):** `canvasPixelFromEvent` maps client
  coordinates through a scaled canvas to the correct clamped pixel indices.
- **E2E (`e2e/shader.spec.js`):** add a levels-on param set so the GLSL `applyLevels`
  path is pinned equal to the JS reference within ±2.
- **E2E (`e2e/app.spec.js`):** assert the Anchor group and its four buttons are present;
  eyedropper buttons disabled before an image loads.
- **E2E (`e2e/anchor.spec.js`):** load a known synthetic image via the file input, arm
  "white", click a pixel, and assert that pixel in the result reads ~neutral (R≈G≈B near
  white) within tolerance.

## Out of scope (future iterations)

- Maintaining the anchor as a constraint while other controls change (auto-compensate).
- Locking individual controls so an auto-solver only moves unlocked ones.
- Source-side anchoring (this feature anchors on the output).
- Per-channel manual levels sliders.
- Sampling region size control / variable eyedropper radius.
