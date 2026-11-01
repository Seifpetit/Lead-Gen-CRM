import { expect, test, type Page } from '@playwright/test';

// One pass through the whole journey against the fake Apify: sign in, preview and start a run,
// watch it on the Logs page, open the result, and work the two CRM boards.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

/** Drags a card (anywhere on it, here by its name) onto a column with the mouse, the way a person does. */
async function dragTo(page: Page, name: string, column: string) {
  const card = page.getByRole('group', { name, exact: true });
  const target = page.getByRole('region', { name: column, exact: true });
  const from = (await card.getByRole('heading').boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 22, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 140, { steps: 12 });
  await page.mouse.up();
  // The drop's own click is swallowed for a moment; a person never clicks faster than this.
  await page.waitForTimeout(150);
}

/** The keyboard way: a card's "Move to" menu. */
async function moveTo(page: Page, name: string, column: string) {
  await page.getByRole('button', { name: `Move ${name} to` }).click();
  await page.getByRole('list', { name: 'Move to' }).getByRole('button', { name: column }).click();
}

test('sign in, run, watch, open the result, and work the two CRM boards', async ({ page }) => {
  // A run now covers every sector, so it takes about a minute here and twice that on CI.
  test.setTimeout(300_000);
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
  // Sign-in returns to the page that was asked for: the CRM (Companies board), which starts empty.
  await expect(page.getByRole('heading', { name: 'CRM', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/crm\/companies$/);
  await expect(page.getByText('No companies on the board yet')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Lead Gen', 'CRM']);
  await nav.getByRole('link', { name: 'Lead Gen' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  const side = page.getByRole('navigation', { name: 'Lead Gen sections' });
  await expect(side.getByRole('link')).toHaveText(['Dashboard', 'Coverage', 'Costs', 'Runs']);

  // Clean start: no leads and no runs yet.
  await expect(page.getByText('No leads yet. Create a run to find your first ones.')).toBeVisible();
  const runs = page.getByRole('region', { name: 'Runs' });
  await expect(runs.getByText('No runs yet')).toBeVisible();

  // Preview: Create run opens the flow; region first, nothing is spent or started.
  await page.getByRole('button', { name: 'Create run' }).first().click();
  const start = page.getByRole('dialog', { name: 'Start a run' });
  await start.getByRole('combobox', { name: 'Region' }).click();
  await page.getByRole('option', { name: 'Sfax, 0 leads, not searched yet' }).click();
  const estimate = start.getByRole('region', { name: 'Estimate' });
  // There are no sector chips: the run covers every import/export sector.
  const go = start.getByRole('button', { name: /^Start run/ });
  await expect(start.locator('.sr-all-sectors')).toBeVisible();
  await expect(estimate.getByText('Estimated cost')).toBeVisible();
  await expect(estimate.locator('.tag-estimate').first()).toBeVisible();
  await expect(runs.getByText('No runs yet')).toBeVisible();

  // The cap is filled in ($2.00) and shown on the button; Start asks once more if the estimate
  // is above it.
  await expect(go).toHaveText('Start run, up to $2.00');
  await expect(go).toHaveAttribute('aria-disabled', 'false');
  await go.click();
  const yes = start.getByRole('button', { name: 'Yes, start the run' });
  const toast = page.getByText('Run started in sfax.');
  await expect(yes.or(toast)).toBeVisible();
  if (await yes.isVisible()) await yes.click();
  // A toast confirms it and the dialog closes.
  await expect(toast).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The dashboard shows it as active: a live strip under the header and a row in Runs.
  await expect(
    page.getByRole('region', { name: 'Runs in progress' }).getByRole('link').first(),
  ).toBeVisible();
  await expect(
    runs.getByRole('link', { name: 'Open run for sfax' }).getByText('Running'),
  ).toBeVisible();

  // Watch it in the logs, inside the Runs page, while it runs: one compact row, with a Running badge.
  await side.getByRole('link', { name: 'Runs' }).click();
  await page.locator('.segmented label', { hasText: 'Logs' }).click();
  const log = page.getByRole('list', { name: 'Runs, newest first' });
  await expect(log.getByText('Running')).toBeVisible();

  // It finishes on its own.
  await side.getByRole('link', { name: 'Dashboard' }).click();
  await expect(
    runs.getByRole('link', { name: 'Open run for sfax' }).getByText('Completed with leads'),
  ).toBeVisible({
    timeout: 240_000,
  });
  await side.getByRole('link', { name: 'Runs' }).click();
  // Nothing is going now, so the Runs page opens on the logs by itself.
  await expect(page.getByRole('radio', { name: 'Logs' })).toBeChecked();
  await expect(log.getByText('Completed with leads')).toBeVisible();
  // Its whole story opens in a window, and Escape closes it.
  await log.getByRole('button', { name: /^Open log for / }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('The six steps')).toBeVisible();
  await expect(dialog.getByText('Complete log')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Spend shows up on the Costs page.
  await side.getByRole('link', { name: 'Costs' }).click();
  const costs = page.getByRole('region', { name: 'Costs' });
  await expect(costs.getByRole('table')).toBeVisible();

  // The leads it found are listed on the dashboard; one opens on its own page, and Back returns.
  await side.getByRole('link', { name: 'Dashboard' }).click();
  const leads = page.getByRole('list', { name: 'Companies found' });
  await expect(leads).toBeVisible();
  await leads.getByRole('listitem').first().getByRole('link').first().click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Decision-maker', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  // Open the result: people first, every field tagged.
  await runs.getByRole('link', { name: 'Open run for sfax' }).click();
  await expect(page.getByRole('region', { name: 'This run' })).toBeVisible();
  const card = page.getByRole('article').first();
  await expect(card.getByRole('heading', { name: 'Decision-maker' })).toBeVisible();
  await expect(card.locator('.tag-fact, .tag-estimate').first()).toBeVisible();
  await expect(card.getByText('A score is a computed estimate')).toBeVisible();

  // Into the CRM from the run.
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Moved to Confirmed.')).toBeVisible();

  // The Companies board: every company the run found is in Found.
  await nav.getByRole('link', { name: 'CRM' }).click();
  await expect(page).toHaveURL(/\/crm\/companies$/);
  const column = (title: string) => page.getByRole('region', { name: title, exact: true });
  const cards = column('Found').getByRole('listitem');
  await expect(cards.first()).toBeVisible();
  const names = await cards.evaluateAll((els) =>
    els.map((el) => el.querySelector('h4')?.textContent ?? ''),
  );
  expect(names.length).toBeGreaterThanOrEqual(2);
  const [first, second] = names as [string, string];
  await expect(column('Noise')).toContainText('Show Noise (0)');

  // The board fills the window and the page itself does not scroll.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  // Search is applied on the server: only the match is left, and the column total says so.
  await page.getByRole('searchbox', { name: 'Search the board' }).fill(first);
  await expect(column('Found').getByRole('group')).toHaveCount(1);
  await expect(column('Found').getByLabel('1 in total')).toBeVisible();
  // The table lists the same cards, then back to the columns.
  await page.getByText('Table', { exact: true }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await page.getByText('Board', { exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search the board' }).fill('');
  await expect(column('Found').getByRole('group')).toHaveCount(names.length);

  // Drag a card with the mouse, and with the keyboard menu.
  await dragTo(page, first, 'Investigating');
  await expect(column('Investigating').getByRole('group', { name: first })).toBeVisible();
  await moveTo(page, first, 'Found');
  await expect(column('Found').getByRole('group', { name: first })).toBeVisible();

  // The last column needs a decision-maker: cancel puts the card back, saving moves it.
  await dragTo(page, first, 'Decision-maker identified');
  const form = page.getByRole('dialog', { name: `Who is the decision-maker at ${first}?` });
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(column('Found').getByRole('group', { name: first })).toBeVisible();
  await moveTo(page, first, 'Decision-maker identified');
  await form.getByRole('button', { name: 'Save decision-maker' }).click();
  await expect(form.getByText('Write their name.')).toBeVisible();
  await form.getByLabel('Full name').fill('Amel E2E');
  await form.getByLabel('Job title').fill('Responsable logistique');
  await form.getByLabel('Email').fill('amel.e2e@example.test');
  await form.getByRole('button', { name: 'Save decision-maker' }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByText(`Amel E2E added. ${first} moved to Decision-maker identified.`),
  ).toBeVisible();
  await expect(
    column('Decision-maker identified').getByRole('group', { name: first }),
  ).toBeVisible();

  // The person is on the People board, in New. Work them, then opt them out.
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page).toHaveURL(/\/crm\/people$/);
  await expect(column('New').getByRole('group', { name: 'Amel E2E' })).toBeVisible();
  await dragTo(page, 'Amel E2E', 'Contacted');
  await expect(column('Contacted').getByRole('group', { name: 'Amel E2E' })).toBeVisible();
  await moveTo(page, 'Amel E2E', 'Opted out');
  const optOut = page.getByRole('dialog', { name: 'Record an objection and opt out?' });
  await optOut.getByRole('button', { name: 'Record objection and opt out' }).click();
  await expect(optOut.getByText('Write the reason first.')).toBeVisible();
  await optOut.getByLabel('What did they say?').fill('Asked by phone not to be contacted');
  await optOut.getByRole('button', { name: 'Record objection and opt out' }).click();
  await expect(optOut).toHaveCount(0);
  const optedOut = column('Opted out').getByRole('group', { name: 'Amel E2E' });
  await expect(optedOut).toBeVisible();
  await expect(optedOut.getByRole('button')).toHaveCount(0);
  // Reloading keeps it: the server holds the board.
  await page.reload();
  await expect(column('Opted out').getByRole('group', { name: 'Amel E2E' })).toBeVisible();

  // Back on Companies: remove another company to Noise and restore it.
  await page.getByRole('tab', { name: 'Companies' }).click();
  await page.getByRole('button', { name: `Remove ${second}` }).click();
  await expect(page.getByText(`${second} moved to Noise. 30 days left.`)).toBeVisible();
  await column('Noise')
    .getByRole('button', { name: /Show Noise/ })
    .click();
  const removed = column('Noise').getByRole('group', { name: second });
  await expect(removed).toContainText('30 days left');
  await removed.getByRole('button', { name: `Restore ${second}` }).click();
  await expect(column('Found').getByRole('group', { name: second })).toBeVisible();

  // Sign out ends the session; it is in the profile menu.
  await page.getByRole('button', { name: new RegExp(EMAIL) }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/leadgen');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
