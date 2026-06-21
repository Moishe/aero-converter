import { test, expect } from '@playwright/test';

// Loads a solid gray image, picks "white" on it, and asserts the clicked pixel
// becomes ~white in the result (the white anchor maps that pixel's value to 1).
test('white eyedropper anchors the clicked pixel to neutral white', async ({ page }) => {
  await page.goto('/');

  // Inject a solid gray PNG through the real file input (in-browser, no fixture file).
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'gray.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Image loaded => export + anchor buttons enabled.
  await expect(page.locator('#export')).toBeEnabled();
  await expect(page.locator('#anchor-white')).toBeEnabled();

  await page.click('#anchor-white');
  await page.locator('#result-canvas').click(); // clicks the canvas center

  const px = await page.evaluate(() => {
    const rc = document.getElementById('result-canvas');
    const o = document.createElement('canvas');
    o.width = rc.width; o.height = rc.height;
    const octx = o.getContext('2d');
    octx.drawImage(rc, 0, 0);
    const cx = Math.floor(rc.width / 2), cy = Math.floor(rc.height / 2);
    const d = octx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

  for (const channel of px) expect(channel).toBeGreaterThan(250);
});
