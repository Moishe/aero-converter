# Guided Auto Recipe Solver (Replace Levels Fit) — Design

**Date:** 2026-07-05
**Status:** Approved design, pending implementation plan
**Builds on:** 2026-07-05-guided-auto-design.md (replaces its solver), 2026-06-20-ir-converter-design.md
**Supersedes:** the levels-based `solveGuided` in `src/guided.js`

## Purpose

The shipped guided-auto solver fits the final per-channel **levels** stage. Field
testing showed this fails on real photos: a per-channel monotonic map cannot send
two nearly equal inputs to very different outputs. Evidence (desert photo, console
capture): sky and clouds had pre-levels blue of 0.51 vs 0.53 but targets of 0.75 vs
0.92; the solver pinned gamma at its clamps on all three channels (10, 0.1, 0.1),
crushing green/blue and producing an orange cast with a green sky.

The fix: the solver manipulates the **recipe's own controls** — the IR-subtraction
opacities and the per-channel gain/gamma/offset curves — where the needed degrees of
freedom actually live. Moving an opacity changes the *spacing* of the three samples'
channel inputs, which is exactly what the levels fit lacked. The three-click UX is
unchanged; only what the solve writes changes.

Two control changes make solving succeed on real photos (verified against the desert
capture, which needs `opacityR ≈ 0.2` and `gamma ≈ 7.2` on red):

1. **New `opacityR` control** (default 0): the red input becomes
   `ir − opacityR·green_src`. Symmetric with the existing opacities; removes residual
   visible light from the IR signal. Default 0 is bit-identical to current behavior.
2. **Gamma slider range widens to 0.1–10** on all three channel groups (was 0.2–5).
   Range change only; no math change. Existing presets remain valid (all in-range).

## Recipe change (transform + shader)

`transformPixel` / `transformPixelPreAnchor` channel mapping becomes:

```
ir    = sb
R_out = curveR(ir − opacityR·sg)
G_out = curveG(sr − opacityG·ir)
B_out = curveB(sg − opacityB·ir)
```

- `src/defaults.js`: add `opacityR: 0.0` beside `opacityG`/`opacityB`. `withDefaults`
  backfills old presets automatically.
- `src/shader.glsl`: add `uniform float u_opacityR;`; red line becomes
  `applyCurve(ir - u_opacityR * src.g, u_curveR)`.
- `src/webgl.js`: look up and set `u_opacityR` in `render()`.
- The highlight-desat and levels stages are untouched.

## The solver

`solveGuided(sourceSamples, targets)` now takes the **raw source samples**
(`{ sky, foliage, clouds }` of `{r,g,b}` in [0,1], straight from `sampleSource`) and
returns recipe controls:

```
{ opacityR, opacityG, opacityB,
  curveR: {gain, gamma, offset},
  curveG: {gain, gamma, offset},
  curveB: {gain, gamma, offset} }
```

Each output channel is solved independently. All three share one shape — input
`x = a − k·b`, output `y = clamp01(gain·x + offset)^(1/gamma)` — with:

| channel | a (per sample) | b (per sample) | k written to |
|---------|----------------|----------------|--------------|
| red     | `sb` (IR)      | `sg`           | `opacityR`   |
| green   | `sr`           | `sb` (IR)      | `opacityG`   |
| blue    | `sg`           | `sb` (IR)      | `opacityB`   |

Key identity: for targets strictly in (0,1), `y = (gain·x + offset)^(1/gamma)` ⇔
`y^gamma = gain·x + offset` — **linear in gain/offset once gamma is fixed**.

Per-channel search:

1. Grid over `k ∈ [0,1]` step 0.02 (51 values).
2. For each `k`: compute `x_i = a_i − k·b_i`; skip this `k` if
   `max(x_i) − min(x_i) < 1e-3` (samples inseparable).
3. Grid over `gamma`: 61 log-spaced values on [0.1, 10]. After the full coarse
   grid, refine around the best cell: sweep `k` at step 0.002 over ±0.02 of the best
   `k`, and for each refined `k` refine gamma by golden-section (≥20 iterations)
   seeded from the best cell's gamma neighborhood.
4. At each `(k, gamma)`: closed-form least-squares line through the three points
   `(x_i, y_i^gamma)` gives `gain`/`offset`; clamp `gain` to [0, 2], `offset` to
   [−0.5, 0.5], `gamma` to [0.1, 10] (the slider ranges, so results are always
   displayable and hand-tunable).
5. Score = `Σ_i (curve(x_i; gain, gamma, offset) − y_i)² + 0.001·(ln gamma)²`
   — the residual is computed through the REAL curve (including its clamp), and the
   regularizer prefers moderate curves among near-ties.
6. Keep the global best `(k, gain, gamma, offset)` across the whole search.

Properties: exact solutions score ≈ 0 and are found by the same path as best-effort
ones (no separate fallback); the search is pure, deterministic, and ~3k trivial
evaluations per channel (instant). If every `k` was skipped as inseparable, the
channel keeps its `DEFAULTS` values (opacity and curve).

Targets are unchanged: sky `[0.25, 0.40, 0.75]`, foliage `[0.80, 0.15, 0.35]`,
clouds `[0.92, 0.92, 0.92]`.

## Guided flow changes (`src/ui.js`)

On the third click, `solveGuidedFromSamples`:

1. `params = cloneDefaults()` (levels identity, highlight off — both stay that way).
2. `const solved = solveGuided(guidedSamples, TARGETS)` — raw samples, no
   `transformPixelPreAnchor` in the guided path (the eyedroppers still use it).
3. Copy `solved.opacityR/G/B` and `solved.curveR/G/B` into `params`.
4. `syncControlsFromParams()` + `render()` — the result is visible in the sliders
   and hand-tunable; the neutral-anchor eyedropper remains available as a refinement.

UI control table changes:

- Red group gains `{ path: 'opacityR', label: 'Visible opacity', min: 0, max: 1, step: 0.01 }`.
- All three `curve*.gamma` sliders: `min: 0.1, max: 10` (step 0.01 unchanged).

`src/guided.js` is rewritten: `TARGETS` stays; the levels-based `solveGuided` and
`bisect` are removed (nothing else imports them) and replaced by the recipe solver
(with an internal golden-section helper).

## Testing

- **Unit (`test/transform.test.js`):** `opacityR` default 0 leaves `transformPixel`
  output unchanged (back-compat); a nonzero `opacityR` subtracts `sg` from the red
  input as specified.
- **Unit (`test/guided.test.js`, rewritten):**
  - **Desert regression fixture** (the real console capture): sources
    sky `(0.659, 0.515, 0.101)`, foliage `(0.459, 0.183, 0.177)`,
    clouds `(1.000, 0.753, 0.539)`. Assert that applying the solved controls via
    `transformPixel` reproduces all nine targets within 0.02 — this exact field
    failure can never return.
  - A feasible synthetic case solves near-exactly (≤ 1e-3 per target).
  - Solved params always within slider ranges; solver never throws and is
    deterministic (two runs give identical output).
  - Inseparable samples (all three identical) leave that channel at defaults.
- **E2E (`e2e/shader.spec.js`):** add a param set with `opacityR ≠ 0` to the pin so
  the GLSL red-input change is verified against the JS reference.
- **E2E (existing):** the guided-flow stripe test and cancellation test are
  behavioral and still apply; the stripe fixture remains solvable by the new solver
  (verified analytically: red fits at `k=0, gamma≈6`).

## Out of scope

- Editable target swatches (still deferred).
- Solver use of the highlight-desat or levels stages (levels remain the neutral
  anchor's tool; guided writes only recipe controls).
- Fully automatic region detection.
