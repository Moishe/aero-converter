import { test, expect } from '@playwright/test';

test('app loads without console errors and shows controls', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#file-input')).toBeVisible();
  await expect(page.locator('#control-groups .group')).toHaveCount(4);
  await expect(page.locator('#export')).toBeDisabled();
  expect(errors, errors.join('\n')).toEqual([]);
});
