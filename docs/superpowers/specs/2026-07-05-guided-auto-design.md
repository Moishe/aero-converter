# Guided Auto (Tag Sky / Foliage / Clouds) — Design

**Date:** 2026-07-05
**Status:** Approved design, pending implementation plan
**Builds on:** 2026-06-20-ir-converter-design.md, 2026-06-20-highlight-desaturation-design.md, 2026-06-21-neutral-anchor-design.md

## Purpose

Give the user a first-cut "auto" path to a correct aerochrome look — **sky blue,
clouds white, foliage red** — without hand-tuning sliders. Rather than blindly
segmenting the image, the user tags three regions (sky, foliage, clouds); the app
fits the existing per-channel levels stage so those three samples land on target
colors. It is a semantic generalization of the neutral-anchor eyedropper (three
sample→target points instead of one sample→neutral), and reuses the levels stage
end-to-end — no new pipeline math or shader changes.

## User flow

A single **"Guided Auto"** button (in the Anchor group), disabled until an image is
loaded. Clicking it starts a sequential flow driven by a small status line:

1. *"Click the sky…"* — user clicks the Result image; the app samples that region.
2. *"Click the foliage…"* — sample.
3. *"Click the clouds…"* — sample.

The Result canvas shows a crosshair cursor during the flow. After the third click the
app resets to defaults, solves, applies the result, re-renders, syncs the sliders, and
clears the status line. Clicking "Guided Auto" again, or arming any eyedropper, cancels
the in-progress flow.

Sampling reuses the eyedropper's machinery: `canvasPixelFromEvent` for the click→pixel
mapping and the 3×3 source-average sampler.

## The solve

On the third click:

1. `params = cloneDefaults()` — a clean, repeatable slate (channels at baseline,
   highlight off, levels identity). The solve always starts from defaults, so its
   result depends only on the three sampled regions.
2. For each tagged region, compute its **pre-levels** value under the default channel
   params: `pre = transformPixelPreAnchor(sample, params)` (channels in [0,1]).
3. `params.levels = solveGuided({ sky, foliage, clouds } pre-values, TARGETS)`.

### `solveGuided(preSamples, targets) → levels`

Pure function. `preSamples` is `{ sky, foliage, clouds }` of `{r,g,b}` pre-levels
values; `targets` is `{ sky, foliage, clouds }` of `[r,g,b]` target colors. Returns a
`levels` object `{ black:[r,g,b], white:[r,g,b], gamma:[r,g,b] }`.

Each output channel is fit **independently**. For channel `c` we have three points
`(x_i, y_i)` where `x_i` is the pre-levels value of sample `i` in channel `c` and `y_i`
is `targets[i][c]`. We fit `black_c, white_c, gamma_c` so `applyLevels` maps each
`x_i → y_i`.

The levels map for interior points is `y = ((x - black)/(white - black))^(1/gamma)`, i.e.
`x = black + W·y^gamma` with `W = white - black`. Given three points this reduces to a
**one-dimensional solve for `gamma`**: sort the points by `x`, form the ratio
`R = (x_lo - x_mid)/(x_mid - x_hi)` and find `gamma` in `[0.1, 10]` where
`(y_lo^gamma - y_mid^gamma)/(y_mid^gamma - y_hi^gamma) = R` by bisection. Then
`W = (x_lo - x_mid)/(y_lo^gamma - y_mid^gamma)`, `black = x_lo - W·y_lo^gamma`,
`white = black + W`.

Clamps and fallback:
- `gamma` clamped to `[0.1, 10]`; if no sign change brackets the root, clamp to the
  endpoint minimizing `|G(gamma) - R|` (best effort).
- `black`, `white` clamped to `[-1, 2]` (generous; `applyLevels` clamps the normalized
  value to [0,1] regardless).
- A channel **falls back to identity** (`black=0, white=1, gamma=1`) when it is
  degenerate: any two `x_i` within a small epsilon, `W` non-finite or `≤ 0`, or the
  `y` denominators zero. This prevents wild output when a scene does not cooperate.

The fit hits all three targets exactly when the per-channel relationship is monotonic
(the common case for real scenes), and degrades gracefully otherwise. This is an honest
first-cut guess, not a guarantee.

## Target constants

Fixed constants in the solver module (channels in [0,1]), chosen from real aerochrome:

| Region  | Target `[r, g, b]`      | Look                         |
|---------|-------------------------|------------------------------|
| Sky     | `[0.25, 0.40, 0.75]`    | cyan-blue                    |
| Foliage | `[0.80, 0.15, 0.35]`    | crimson / pink-red           |
| Clouds  | `[0.92, 0.92, 0.92]`    | near-white (detail retained) |

These are tunable constants. The user's before/after Photoshop pairs (raw input +
processed output) can later calibrate them and seed a validation test — optional, and
not required for v1.

## Files

- **New `src/guided.js`** — the `TARGETS` constant, the pure `solveGuided(preSamples, targets)`,
  and an internal bisection root-find helper. Self-contained; depends on nothing.
- **`src/ui.js`** — the Guided Auto button element; a `guidedStep` state
  (`null | 'sky' | 'foliage' | 'clouds'`); a status-text updater; extension of the
  existing Result-canvas click handler to route clicks to the guided flow when active;
  the reset-then-solve on the third click; mutual exclusion with the eyedropper modes;
  enable-on-load alongside Export and the eyedroppers.
- **`index.html`** — the "Guided Auto" button and a status element (e.g. `#guided-status`).
- **No change** to `src/transform.js` math, `src/shader.glsl`, `src/webgl.js`, or
  `src/defaults.js` — the flow writes the existing `levels` block.

## Error handling

- Guided Auto disabled until an image is loaded.
- A Result-canvas click with no eyedropper armed and no guided flow active does nothing
  (existing guard).
- Starting the guided flow disarms any armed eyedropper and vice versa (one active
  interaction at a time).
- The solver never throws: degenerate channels fall back to identity; all outputs are
  finite and within clamp ranges.

## Testing

Built TDD.

- **Unit (`test/guided.test.js`):**
  - For a feasible synthetic case (three pre-samples whose per-channel ordering is
    consistent with the targets), `applyLevels(pre_i, solveGuided(...))` reproduces each
    `target_i` within a small tolerance.
  - Degenerate input (two identical pre-samples) returns finite, in-range `levels` with
    the affected channel(s) at identity and never throws.
  - The bisection helper converges to a known root of a simple monotonic function.
- **E2E (`e2e/guided.spec.js`):** load a crafted synthetic image with three distinct
  flat regions, run the guided flow clicking each region as sky/foliage/clouds, and
  assert the foliage region renders red-dominant (`R > G` and `R > B`) and the flow
  completes without console errors.
- The existing shader pin already covers the `levels` GLSL path; no shader test change.

## Out of scope (future iterations)

- Exposing the target colors as editable swatches/pickers (explicitly deferred to a
  later step).
- Fully-automatic region detection (auto-picking the three samples with no clicks);
  could later reuse `solveGuided`.
- Nudging channel gains/opacities or highlight in addition to levels.
- Calibrating the target constants from before/after pairs (optional follow-up).
