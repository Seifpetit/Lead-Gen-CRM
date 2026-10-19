import { expect, test, type Locator, type Page } from '@playwright/test';

// The Start a run window with 15 sectors and a live estimate: it never scrolls at desktop sizes,
// stacks its two columns below 800px, and starts nothing until Start is pressed. Sign-in is real;
// the data and the estimate are replaced.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

const SECTORS = [
  'olive-oil',
  'agri-food',
  'dates-produce',
  'textile',
  'construction-materials',
  'steel-metal',
  'chemicals',
  'plastics-packaging',
  'automotive-parts',
  'pharma',
  'wholesale',
  'import-export',
  'retail-chains',
  'furniture',
].map((id) => ({ id, name: id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));

const region = (regionId: string, name: string, over = {}) => ({
  regionId,
  name,
  hasBounds: true,
  status: 'active',
  saturatedAt: null,
  cellsTotal: 8,
  cellsSearched: 2,
  cellsExhausted: 0,
  coverage: 0.25,
  queriesRun: 12,
  placesFound: 80,
  newPlacesPerQuery: 4.5,
  qualifiedShare: 0.15,
  decisionMakerShare: 0.5,
  channelShare: 0.7,
  spendUsd: 4.2,
  leads: 32,
  costPerLeadUsd: 0.6,
  runs: 2,
  lastRunAt: '2026-10-17T10:00:00.000Z',
  ...over,
});

const PREVIEW = {
  regionId: 'sfax',
  mode: 'normal',
  cells: [{ cellKey: 'r0c0', reason: 'least searched' }],
  queries: Array.from({ length: 6 }, (_, i) => ({
    wording: `transport ${i}`,
    sectorId: 'textile',
    cellKey: 'r0c0',
  })),
  queriesTotal: 6,
  sectors: [{ id: 'textile', name: 'Textile', wordings: ['transport'] }],
  volume: {
    placesMax: 300,
    places: 150,
    newPlaces: 150,
    qualified: 18,
    people: 9,
    leads: 6,
    kind: 'estimate',
  },
  cost: {
    discoverUsd: 1.5,
    findPeopleUsd: 1.8,
    enrichUsd: 0.2,
    totalUsd: 3.5,
    perLeadUsd: 0.58,
    upperBoundUsd: 3,
    kind: 'estimate',
  },
  limits: {
    budgetCapUsd: 2,
    monthCapUsd: 50,
    monthSpentUsd: 5,
    monthRemainingUsd: 45,
    activeRuns: 0,
    maxActiveRuns: 2,
    maxRunCapUsd: 50,
  },
  blockers: [],
  assumptions: ['Each query returns about half its maximum places (no history yet)'],
};

async function signIn(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/coverage',
    (route) =>
      route.fulfill({
        json: {
          regions: [
            { regionId: 'sfax', name: 'Sfax' },
            { regionId: 'tunis', name: 'Tunis' },
          ],
          sectors: SECTORS,
          entries: [
            {
              regionId: 'sfax',
              sectorId: 'textile',
              queriesRun: 12,
              newPlaces: 40,
              leads: 5,
              spendUsd: 2.5,
              costPerLeadUsd: 0.5,
              lastRunAt: '2026-10-17T10:00:00.000Z',
              state: 'yielding',
            },
          ],
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/regions',
    (route) =>
      route.fulfill({
        json: {
          items: [
            region('sfax', 'Sfax'),
            region('tunis', 'Tunis', { coverage: null, leads: 0, runs: 0 }),
            region('gabes', 'Gabès', { hasBounds: false, coverage: null, leads: 0, runs: 0 }),
          ],
          total: 3,
          limit: 100,
          offset: 0,
          nextOffset: null,
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/runs/preview',
    (route) => route.fulfill({ json: PREVIEW }),
  );
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** Opens the Region list and clicks one option (the list is the app's own, not a native select). */
async function pickRegion(dialog: Locator, option: string) {
  await dialog.getByRole('combobox', { name: 'Region' }).click();
  await dialog.page().getByRole('option', { name: option }).click();
}

/** True when nothing inside the window needs scrolling. */
const fits = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('.modal-start')!;
    const body = dialog.querySelector<HTMLElement>('.modal-body')!;
    return {
      body: body.scrollHeight <= body.clientHeight,
      dialog: dialog.scrollHeight <= dialog.clientHeight,
      inWindow: dialog.getBoundingClientRect().bottom <= window.innerHeight,
    };
  });

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`does not scroll at ${size.width} x ${size.height}, with 15 sectors`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page);
    await page.goto('/leadgen');
    await page.getByRole('button', { name: 'Create run' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Start a run' });
    await pickRegion(dialog, 'Sfax, 32 leads, partly covered');
    await expect(dialog.getByRole('button', { name: 'Textile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.getByRole('region', { name: 'Estimate' }).getByText('$3.50')).toBeVisible();
    await expect(dialog.getByText('Estimate is above your cap')).toBeVisible();
    expect(await fits(page)).toEqual({ body: true, dialog: true, inWindow: true });
    if (process.env.STARTRUN_SHOTS)
      await page.screenshot({ path: `${process.env.STARTRUN_SHOTS}/wide-${size.width}.png` });

    // The open Region list is a card drawn over the window; Escape closes it and not the window.
    await dialog.getByRole('combobox', { name: 'Region' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    if (process.env.STARTRUN_SHOTS)
      await page.screenshot({ path: `${process.env.STARTRUN_SHOTS}/list-${size.width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Region' })).toBeFocused();

    // The advanced part opens without the window growing past the screen.
    await dialog.getByText('Advanced').click();
    const stillInWindow = await page.evaluate(
      () =>
        document.querySelector('.modal-start')!.getBoundingClientRect().bottom <=
        window.innerHeight,
    );
    expect(stillInWindow).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create run' }).first()).toBeFocused();
  });
}

test('below 800px the columns stack, the estimate under the choices', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 });
  await signIn(page);
  await page.goto('/leadgen');
  await page.getByRole('button', { name: 'Create run' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Start a run' });
  await pickRegion(dialog, 'Sfax, 32 leads, partly covered');
  const left = (await dialog.locator('.sr-left').boundingBox())!;
  const right = (await dialog.locator('.sr-right').boundingBox())!;
  expect(right.y).toBeGreaterThanOrEqual(left.y + left.height - 3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (process.env.STARTRUN_SHOTS)
    await page.screenshot({ path: `${process.env.STARTRUN_SHOTS}/narrow.png` });
});

test('Start stays off until a region and a sector are picked, and previewing starts nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  let started = 0;
  await page.route(
    (url) => url.pathname === '/api/runs',
    (route) => {
      if (route.request().method() === 'POST') started++;
      return route.fallback();
    },
  );
  await page.goto('/leadgen');
  await page.getByRole('button', { name: 'Create run' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Start a run' });
  const start = dialog.getByRole('button', { name: /^Start run/ });
  await expect(start).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByText('Choose a region to start.')).toBeVisible();
  await pickRegion(dialog, 'Tunis, 0 leads, not searched yet');
  await expect(dialog.getByText('Pick at least one sector')).toBeVisible();
  await dialog.getByRole('button', { name: 'Textile' }).click();
  await expect(start).toHaveAttribute('aria-disabled', 'false');
  await expect(start).toHaveText('Start run, up to $2.00');
  expect(started).toBe(0);
});
