# Highlight Desaturation Control — Design

**Date:** 2026-06-20
**Status:** Approved design, pending implementation plan
**Builds on:** 2026-06-20-ir-converter-design.md

## Purpose

The IRG transform maps the IR (blue) channel to the red output. In bright areas
(foliage, sky) the IR channel is high, so highlights bleed toward saturated
red/magenta and lose detail. This adds an optional final stage that pulls bright
pixels toward a neutral of the same brightness, removing the color cast in
highlights while leaving midtones and shadows untouched. It is **off by default**,
so existing output and tests are unchanged until the user enables it.

## The transform stage

After the existing per-channel transform produces output `rgb` (each channel in
[0,1]), apply:

```
value  = max(r, g, b)
t      = clamp((value - threshold) / max(1 - threshold, 1e-5), 0, 1)
weight = t * t * (3 - 2 * t) * amount       // smoothstep knee × strength
rgb    = mix(rgb, vec3(value), weight)      // blend toward bright neutral gray
```

- `value = max(R,G,B)` is the highlight measure. It catches colored highlights
  (e.g. magenta `(0.97, 0.18, 0.78)`) that a perceptual-luminance measure would
  read as a midtone and miss.
- The blend target is `vec3(value)` — a neutral gray at the same value — so a
  highlight neutralizes without getting darker or whiter.
- `weight` is in [0,1]; `mix` of two [0,1] values stays in [0,1], so no extra
  clamp is needed.
- `amount = 0` makes `weight = 0`, an exact identity. This is the default.
- `max(1 - threshold, 1e-5)` guards against divide-by-zero if a stored preset has
  `threshold = 1`.

The smoothstep is implemented **manually** (the expression above), not via the
GLSL built-in `smoothstep`, in both the JS reference and the shader, so the two
implementations are byte-for-byte equivalent and the e2e shader-pin stays exact.

## Parameters

New param block, added to the existing param object:

```
highlight: { amount: 0.0, threshold: 0.7 }
```

| Control   | Default | Range     | Step | Notes                                   |
|-----------|---------|-----------|------|-----------------------------------------|
| amount    | 0.0     | 0 – 1     | 0.01 | Strength; 0 = stage disabled (identity) |
| threshold | 0.7     | 0 – 1     | 0.01 | Value where the rolloff begins          |

## File changes

- `src/defaults.js` — add the `highlight` block to `DEFAULTS`.
- `src/transform.js` — add `smoothstep(e0, e1, x)` and
  `applyHighlightDesat(rgb, { amount, threshold })`; call it at the end of
  `transformPixel` on the computed `{r,g,b}`.
- `src/shader.glsl` — add `uniform vec2 u_highlight` (x = amount, y = threshold);
  apply the same step after the channel mapping, before `gl_FragColor`.
- `src/webgl.js` — look up and set `u_highlight` in `render()` via
  `gl.uniform2f(u.highlight, params.highlight.amount, params.highlight.threshold)`.
- `src/ui.js` — add a fourth control group ("Highlights") with the two sliders,
  using the existing control config / slider-build pattern. The `getPath`/`setPath`
  helpers already handle the `highlight.amount` / `highlight.threshold` paths.

Presets need no code change: the new field serializes through `savePreset` /
`loadPresets` automatically.

## UI

A new **"Highlights"** group rendered below the three channel groups, same
slider + numeric-readout pattern as the existing groups:

- **Amount** — 0–1, step 0.01, default 0
- **Threshold** — 0–1, step 0.01, default 0.7

## Testing

Built TDD; default-off means existing tests stay green.

- **Unit (`test/transform.test.js`):**
  - `applyHighlightDesat` with `amount = 0` is identity for any pixel.
  - `amount = 1`, pixel value above threshold → output equals `vec3(value)`
    (fully neutralized at same value).
  - A pixel whose `value` is at or below `threshold` is unchanged regardless of
    amount.
  - Output stays within [0,1].
  - `smoothstep` returns 0 at/below `e0`, 1 at/above `e1`, and 0.5 at the midpoint.
  - `transformPixel` with default params (amount 0) is unchanged from current
    behavior.
- **E2E (`e2e/shader.spec.js`):** add a second params set with
  `highlight.amount > 0` (and a threshold that the test colors exceed) to the pin
  loop, asserting the GLSL desaturation path matches the JS reference within ±2.
- **E2E (`e2e/app.spec.js`):** update the control-group count assertion from 3 to 4.

## Out of scope

- Per-channel or hue-selective desaturation.
- Blending toward white (filmic clip) — we blend toward same-value gray.
- Any change to the existing channel-mapping math or defaults.
