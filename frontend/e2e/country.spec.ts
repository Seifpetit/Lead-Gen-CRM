import { expect, test } from '@playwright/test';

// The country switch in a real browser: it changes the page at once without reloading, is kept
// in the address and in the browser, greys out a country that is switched off, and shows the
// data-protection notice once for a European country.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

test('switching country redraws the page without a reload and is remembered', async ({ page }) => {
  await page.goto('/leadgen');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/country=TN/);

  // A marker on the window is lost on any reload.
  await page.evaluate(() => {
    (window as unknown as { __kept: boolean }).__kept = true;
  });

  await page.getByRole('button', { name: /^Country: Tunisia/ }).click();
  const menu = page.getByRole('list', { name: 'Country' });
  await expect(menu.getByRole('button', { name: /^Germany/ })).toBeDisabled();
  await expect(menu.getByRole('button', { name: /^Italy/ })).toBeDisabled();
  await menu.getByRole('button', { name: /^France/ }).click();

  // The notice for European countries comes once.
  const notice = page.getByRole('dialog', { name: 'Before you search in France' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'I understand' }).click();
  await expect(notice).toHaveCount(0);

  await expect(page).toHaveURL(/country=FR/);
  await expect(page.getByRole('button', { name: /^Country: France/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);

  // Remembered: a fresh load of the plain address opens in France, with no notice again.
  await page.goto('/leadgen');
  await expect(page.getByRole('button', { name: /^Country: France/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The boards can show every country.
  await page.getByRole('link', { name: 'CRM' }).click();
  await page.getByRole('button', { name: /^Country: France/ }).click();
  await page.getByRole('button', { name: 'All countries' }).click();
  await expect(
    page.getByRole('button', { name: 'Country: All countries. Change country' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/country=ALL/);
});
