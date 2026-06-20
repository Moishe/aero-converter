# IR/Aerochrome Image Converter — Design

**Date:** 2026-06-20
**Status:** Approved design, pending implementation plan

## Purpose

A browser-based, backend-free tool that converts a photo taken with a full-spectrum
camera (IR filter removed) shooting through a yellow filter into a false-color
"aerochrome"/IRG image. The transform swaps and recombines channels, subtracts the IR
signal from two output channels, and lets the user tune the look with live controls.

Everything runs client-side. A WebGL fragment shader performs the per-pixel transform
in real time as the user adjusts controls. No image is uploaded to or stored on any
server.

## Core transform

Source pixel channels are normalized to `sr, sg, sb` in `[0, 1]`. The blue channel is
the IR signal:

```
ir = sb
```

A reusable per-channel **curve** is defined as:

```
curve(x; gain, gamma, offset) = clamp(gain * x + offset, 0, 1) ^ (1 / gamma)
```

- `gain` — multiplier (brighten if > 1, dim if < 1)
- `offset` — additive lift
- `gamma` — midtone bend (the "curve")

Application order: linear (`gain * x + offset`), clamp to `[0, 1]`, then gamma. The
final result is in `[0, 1]`.

### Channel mapping

| Output channel | Source            | Formula                          |
|----------------|-------------------|----------------------------------|
| **R_out**      | IR                | `curveR(ir)`                     |
| **G_out**      | red, *dimmed*     | `curveG(sr - opacityG * ir)`     |
| **B_out**      | green, *brightened* | `curveB(sg - opacityB * ir)`   |

Where `opacityG` and `opacityB` are the IR-subtraction opacities for the green and
blue output channels respectively.

### Controls and defaults

| Control            | Default | Range      | Notes                                  |
|--------------------|---------|------------|----------------------------------------|
| `opacityG`         | 0.5     | 0 – 1      | IR subtracted from red→green output     |
| `opacityB`         | 0.5     | 0 – 1      | IR subtracted from green→blue output    |
| `curveR.gain`      | 1.0     | 0 – 2      | IR → red output (identity by default)   |
| `curveR.gamma`     | 1.0     | 0.2 – 5    |                                        |
| `curveR.offset`    | 0.0     | -0.5 – 0.5 |                                        |
| `curveG.gain`      | 0.95    | 0 – 2      | slightly dimmed                         |
| `curveG.gamma`     | 1.0     | 0.2 – 5    |                                        |
| `curveG.offset`    | 0.0     | -0.5 – 0.5 |                                        |
| `curveB.gain`      | 1.05    | 0 – 2      | slightly brightened                     |
| `curveB.gamma`     | 1.0     | 0.2 – 5    |                                        |
| `curveB.offset`    | 0.02    | -0.5 – 0.5 |                                        |

A **Reset** button restores all controls to these defaults.

## Architecture

Vite + Vitest frontend project. Pure-frontend, no backend. Static build deployable to
any static host.

```
index.html
src/
  transform.js   pure transform math (gain/gamma/offset curve, channel mapping). Unit-tested.
  shader.glsl    fragment shader; mirrors transform.js math exactly.
  webgl.js       WebGL context/texture/program setup, render, pixel read-back.
  ui.js          DOM wiring: file load, drag-drop, sliders, reset, export.
  presets.js     save/load/delete named presets in localStorage.
  defaults.js    canonical default parameter values, shared by UI, presets, tests.
test/
  transform.test.js
  presets.test.js
e2e/
  shader.spec.js  Playwright: render known image, read canvas pixels, assert == transform.js.
vite.config.js
playwright.config.js
package.json
```

### Data flow

1. User loads an image (file picker or drag-and-drop). It is decoded to an
   `ImageBitmap`/`<img>` and uploaded once as a WebGL texture.
2. Controls hold the current parameter set. Any change pushes uniforms to the shader
   and triggers a re-render of the result canvas. The source texture is *not*
   re-uploaded on control changes.
3. Export renders at full source resolution and downloads via `canvas.toBlob`.
4. Presets serialize the current parameter set to/from localStorage.

### The two-implementations rule

The transform math exists in both `transform.js` (pure JS, unit-tested) and
`shader.glsl` (GLSL, runs in the browser). This duplication is intentional for
performance. The e2e test renders the real shader and asserts its output matches
`transform.js` within tolerance, so the shader cannot silently drift from the tested
reference.

## UI layout

- **Top:** load area — file picker button plus a drag-and-drop zone covering the page.
- **Middle:** original image (left) and live result (right), side by side.
- **Controls panel:** grouped by output channel (R / G / B). Each group shows its
  sliders with live numeric readouts. The two IR-subtraction opacities sit with their
  respective channels (`opacityG` under G, `opacityB` under B). Reset button.
- **Presets:** name field + Save button, a dropdown to load a saved preset, Delete
  button. Export PNG button.

## Error handling

- Non-image / undecodable file: show an inline message, leave prior state intact.
- WebGL unavailable: show a clear unsupported-browser message instead of a blank canvas.
- Empty/duplicate preset name: validate inline (no silent overwrite without confirm).
- Export before an image is loaded: button disabled until an image is present.

## Testing strategy

Built TDD: tests first for each unit, then implementation.

- **Unit (Vitest):** `transform.js` — identity defaults, channel swap (`R_out === ir`),
  IR subtraction at varying opacities, gain/gamma/offset behavior, clamping at both
  ends, default-parameter snapshot.
- **Integration (Vitest + jsdom):** `presets.js` — save/load/delete round-trip through
  localStorage, parameter serialization, handling of malformed stored data.
- **E2E (Playwright):** load the app, feed a known small synthetic image, read back the
  result canvas pixels, assert they match `transform.js` output within a small tolerance
  (accounts for 8-bit quantization). This pins the GLSL shader to the tested JS math.

## Out of scope for v1

- Intermediate channel previews and histograms (the reference tool shows these).
- Full draggable spline curve editor (we use gain/gamma/offset sliders instead).
- Batch processing, EXIF handling, non-PNG export formats.
