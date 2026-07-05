import { test, expect } from '@playwright/test';

// Loads a 3-stripe image (sky | foliage | clouds source colors), runs the guided
// flow clicking each stripe in order, and asserts the foliage stripe becomes MORE
// red than it rendered by default (proving the solve ran end-to-end — foliage source
// is already reddish at identity levels, so a redder-than-default check is what
// distinguishes a working flow from a no-op) and lands red-dominant.
test('guided auto drives the foliage region toward red', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // Inject a 60x20 image: x[0,20) sky, x[20,40) foliage, x[40,60) clouds.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,51)'; ctx.fillRect(0, 0, 20, 20);   // sky source
    ctx.fillStyle = 'rgb(77,64,128)'; ctx.fillRect(20, 0, 20, 20);   // foliage source
    ctx.fillStyle = 'rgb(242,250,230)'; ctx.fillRect(40, 0, 20, 20); // clouds source
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'stripes.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#guided-auto')).toBeEnabled();

  // Read the foliage (middle) region's rendered pixel.
  const readFoliage = () => page.evaluate(() => {
    const rc = document.getElementById('result-canvas');
    const o = document.createElement('canvas');
    o.width = rc.width; o.height = rc.height;
    o.getContext('2d').drawImage(rc, 0, 0);
    const d = o.getContext('2d').getImageData(30, 10, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

  const before = await readFoliage(); // default render (levels identity)

  await page.click('#guided-auto');
  const canvas = page.locator('#result-canvas');
  const box = await canvas.boundingBox();
  // Click centers of the three stripes: 1/6, 3/6, 5/6 of the width.
  await canvas.click({ position: { x: box.width * (1 / 6), y: box.height / 2 } }); // sky
  await canvas.click({ position: { x: box.width * (3 / 6), y: box.height / 2 } }); // foliage
  await canvas.click({ position: { x: box.width * (5 / 6), y: box.height / 2 } }); // clouds

  const after = await readFoliage();

  // The solve must have run: foliage red rises from its default toward the crimson
  // target (the red channel is a feasible fit ~0.50 -> 0.80). A no-op would leave
  // `after` == `before` and fail this.
  expect(after[0], `foliage red should increase after the solve (before ${before}, after ${after})`)
    .toBeGreaterThan(before[0] + 30);
  // ...and it lands red-dominant.
  expect(after[0], `foliage R should exceed G, got ${after}`).toBeGreaterThan(after[1] + 30);
  expect(after[0], `foliage R should exceed B, got ${after}`).toBeGreaterThan(after[2] + 30);
  await expect(page.locator('#guided-status')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

// Loading a new image while a guided flow is armed must cancel that flow — otherwise
// a solve could mix samples picked against the old image with clicks on the new one.
test('loading a new image cancels an in-progress guided flow', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const loadImage = (fill, name) => page.evaluate(async ({ fill, name }) => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 60, 20);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { fill, name });

  // Load the first image.
  await loadImage('rgb(128,128,51)', 'first.png');
  await expect(page.locator('#guided-auto')).toBeEnabled();

  // Arm the guided flow on image A.
  await page.click('#guided-auto');
  await expect(page.locator('#guided-status')).toBeVisible();

  // Load a second image while the flow is still armed.
  await loadImage('rgb(242,250,230)', 'second.png');

  // The flow must have been cancelled by the new load.
  await expect(page.locator('#guided-status')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
