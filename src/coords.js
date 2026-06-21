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
