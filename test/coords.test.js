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
