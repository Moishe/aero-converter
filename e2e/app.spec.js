import { test, expect } from '@playwright/test';

test('app loads without console errors and shows controls', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#file-input')).toBeVisible();
  await expect(page.locator('#control-groups .group')).toHaveCount(4);
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#anchor-black')).toBeDisabled();
  await expect(page.locator('#anchor-gray')).toBeDisabled();
  await expect(page.locator('#anchor-white')).toBeDisabled();
  await expect(page.locator('#anchor-reset')).toBeDisabled();
  await expect(page.locator('#guided-auto')).toBeDisabled();
  expect(errors, errors.join('\n')).toEqual([]);
});
