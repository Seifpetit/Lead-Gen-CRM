import { expect, test, type Page } from '@playwright/test';

// One pass through the whole journey against the fake Apify: sign in, preview and start a run,
// watch it on the Logs page, open the result, and move a lead through every CRM stage.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

async function moveTo(page: Page, card: ReturnType<Page['locator']>, label: string) {
  await card.getByLabel(/Move .* to another stage/).selectOption({ label });
}

test('sign in, run, watch, open the result, and work a lead through the CRM', async ({ page }) => {
  // Signed out: everything leads to the sign-in screen.
  await page.goto('/crm');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  // A wrong password is refused with a clear message.
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Sign-in returns to the page that was asked for: the CRM, which starts empty.
  await expect(page.getByRole('heading', { name: 'CRM', level: 1 })).toBeVisible();
  await expect(page.getByText('No leads in your pipeline yet')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Lead Gen', 'CRM']);
  await nav.getByRole('link', { name: 'Lead Gen' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  const side = page.getByRole('navigation', { name: 'Lead Gen sections' });
  await expect(side.getByRole('link')).toHaveText(['Dashboard', 'Coverage', 'Costs', 'Logs']);

  // Clean start: no active run, no runs yet.
  await expect(page.getByText('No active run')).toBeVisible();
  const runs = page.getByRole('region', { name: 'Runs' });
  await expect(runs.getByText('No runs yet')).toBeVisible();

  // Preview: Create run opens the flow; region first, nothing is spent or started.
  await page.getByRole('button', { name: 'Create run' }).click();
  const start = page.getByRole('region', { name: 'Start a run' });
  await start.getByLabel('Region').selectOption({ label: 'Sfax' });
  const estimate = start.getByRole('region', { name: 'Estimate' });
  await expect(estimate.getByText('Estimated cost')).toBeVisible();
  await expect(estimate.locator('.tag-estimate').first()).toBeVisible();
  await expect(runs.getByText('No runs yet')).toBeVisible();

  // The cap is required; then an explicit confirm.
  const review = start.getByRole('button', { name: 'Review and start' });
  await expect(review).toBeDisabled();
  await start.getByLabel('Spend cap (USD)').fill('5');
  await expect(review).toBeEnabled();
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm this run' });
  await expect(dialog).toContainText('It will not spend more than $5.00');
  await dialog.getByRole('button', { name: 'Confirm and start run' }).click();
  await expect(start.getByText(/Run started in sfax/)).toBeVisible();

  // The dashboard shows it as active, with its progress bar.
  await expect(page.getByRole('region', { name: 'Create run (1/2)' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(runs.getByRole('row', { name: /sfax/ }).getByText('Running')).toBeVisible();

  // Watch it on the Logs page while it runs.
  await side.getByRole('link', { name: 'Logs' }).click();
  const log = page.getByRole('region', { name: 'Apify log' });
  await expect(log.getByText('Run in sfax')).toBeVisible();
  await expect(log.locator('.badge-apify-running, .badge-apify-started').first()).toBeVisible();

  // It finishes on its own.
  await side.getByRole('link', { name: 'Dashboard' }).click();
  await expect(runs.getByRole('row', { name: /sfax/ }).getByText('Finished')).toBeVisible({
    timeout: 100_000,
  });
  await side.getByRole('link', { name: 'Logs' }).click();
  // A finished run keeps each group of steps collapsed under its totals; open one.
  const searches = log.getByText(/searches done/).first();
  await expect(searches).toBeVisible();
  await searches.click();
  await expect(log.locator('.badge-apify-finished').first()).toBeVisible();

  // Spend shows up on the Costs page.
  await side.getByRole('link', { name: 'Costs' }).click();
  const costs = page.getByRole('region', { name: 'Costs' });
  await expect(costs.getByRole('table')).toBeVisible();

  // Open the result from the dashboard.
  await side.getByRole('link', { name: 'Dashboard' }).click();

  // Open the result: people first, every field tagged.
  await runs.getByRole('link', { name: 'Open run for sfax' }).click();
  await expect(page.getByRole('heading', { name: 'Run in sfax' })).toBeVisible();
  const card = page.getByRole('article').first();
  await expect(card.getByRole('heading', { name: 'Decision-maker' })).toBeVisible();
  await expect(card.locator('.tag-fact, .tag-estimate').first()).toBeVisible();
  await expect(card.getByText('A score is a computed estimate')).toBeVisible();
  const name = (await card.getByRole('heading', { level: 3 }).textContent()) ?? '';

  // Into the CRM from the run.
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Moved to Confirmed.')).toBeVisible();

  // The CRM board: the lead is in Confirmed. Walk it through every other stage.
  await nav.getByRole('link', { name: 'CRM' }).click();
  await page.getByRole('button', { name: /Show closed leads/ }).click();
  const column = (title: string) => page.getByRole('region', { name: title, exact: true });
  const cardIn = (title: string) =>
    column(title).locator('li.card').filter({ hasText: name }).first();

  await expect(cardIn('Confirmed')).toBeVisible();
  const steps = ['Contacted (waiting)', 'Response', 'Won', 'Lost', 'Dismissed'];
  for (const title of steps) {
    const current = page.locator('li.card').filter({ hasText: name }).first();
    await moveTo(page, current, title);
    await expect(cardIn(title)).toBeVisible();
  }

  // Back to a live stage, then opt out: asks first, records the objection.
  await moveTo(page, cardIn('Dismissed'), 'System suggested');
  await expect(cardIn('System suggested')).toBeVisible();
  await moveTo(page, cardIn('System suggested'), 'Opted out');
  const optOut = page.getByRole('dialog', { name: 'Record an objection and opt out?' });
  await optOut.getByRole('button', { name: 'Record objection and opt out' }).click();
  await expect(optOut.getByText('Write the reason first.')).toBeVisible();
  await optOut.getByLabel('What did they say?').fill('Asked by phone not to be contacted');
  await optOut.getByRole('button', { name: 'Record objection and opt out' }).click();
  await expect(optOut).toHaveCount(0);
  await expect(cardIn('Opted out')).toBeVisible();
  await expect(cardIn('Opted out').getByLabel(/Move .* to another stage/)).toHaveCount(0);

  // Sign out ends the session.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/leadgen');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
