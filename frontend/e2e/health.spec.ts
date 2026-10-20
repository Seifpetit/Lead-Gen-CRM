import { expect, test, type Page } from '@playwright/test';

// Failure tracking in a real browser: the Health tab with many errors, the in-app notice and a
// dashboard banner with two failing runs. The page never scrolls, only inner areas do. Sign-in
// goes to the real backend; health and runs are answered here.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';
const SHOTS = process.env.HEALTH_SHOTS;

const funnel = {
  discovered: 24,
  skipped: 0,
  qualified: 12,
  rejected: 12,
  review: 0,
  unreachable: 0,
  peopleFound: 5,
  enriched: 0,
  scored: 0,
  leads: 0,
};
const running = (id: string, region: string, problem: object) => ({
  id,
  region,
  sectors: [],
  mode: 'normal',
  status: 'running',
  currentStage: 'find_people',
  budgetCapUsd: 2.5,
  spentUsd: 0.48,
  placesDroppedOutside: 0,
  customOnly: false,
  customWordings: [],
  cellKeys: [],
  createdAt: '2026-10-19T10:00:00.000Z',
  finishedAt: null,
  funnel,
  error: null,
  liveMessage: 'Looking up the people who work there...',
  stageFraction: 0.5,
  problem,
});
const RUNS = [
  running('p-a', 'Ben Arous', {
    kind: 'provider_down',
    message: 'Apify is out of credit: top up and start a new run',
    since: '2026-10-19T14:20:00.000Z',
    action: 'stop',
  }),
  running('p-b', 'Sfax', {
    kind: 'stuck',
    message: 'This run looks stuck while finding people',
    since: '2026-10-19T14:20:00.000Z',
    action: 'recheck',
  }),
];
const ERRORS = Array.from({ length: 20 }, (_, i) => ({
  id: `err-${i}`,
  source: 'provider',
  provider: 'apify',
  step: 'discover',
  runId: null,
  kind: 'server_error',
  message: `Apify answered with a server error (${i + 1})`,
  stack: 'at call (orchestrator.ts:1:1)',
  count: i + 1,
  firstSeen: '2026-10-19T13:00:00.000Z',
  lastSeen: '2026-10-19T14:20:00.000Z',
}));
const HEALTH = {
  providers: [
    {
      provider: 'apify',
      state: 'down',
      kind: 'out_of_credit',
      reason: 'Apify is out of credit: top up and start a new run',
      since: '2026-10-19T14:20:00.000Z',
      lastOkAt: null,
    },
    { provider: 'anthropic', state: 'ok', kind: null, reason: null, since: null, lastOkAt: null },
  ],
  errors: ERRORS,
  pendingMigrations: ['014_failure_tracking'],
  checks: [
    { id: 'apify_token', status: 'ok', message: 'The Apify key is set.' },
    { id: 'anthropic_key', status: 'warn', message: 'The Anthropic key is not set.' },
    { id: 'database', status: 'ok', message: 'The database answers.' },
    { id: 'migrations', status: 'fail', message: '1 database update is waiting.' },
  ],
  warnings: [{ kind: 'daily_spend_jump', message: "Today's spend, $5.00, is high." }],
  notices: [
    { id: 'provider:apify', message: 'Apify is out of credit: top up and start a new run' },
    { id: 'check:migrations', message: '1 database update is waiting: run npm run db:migrate.' },
  ],
  checkedAt: '2026-10-19T14:21:00.000Z',
};

async function signIn(page: Page) {
  await page.route('**/api/health', (route) => route.fulfill({ json: HEALTH }));
  await page.route('**/api/runs/stream', (route) => route.abort());
  await page.route('**/api/runs/live', (route) =>
    route.fulfill({ json: { runs: RUNS, ended: [] } }),
  );
  await page.route(
    (url) => url.pathname === '/api/leads',
    (route) =>
      route.fulfill({ json: { items: [], total: 0, limit: 25, offset: 0, nextOffset: null } }),
  );
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

function measure() {
  const root = document.documentElement;
  return {
    docHeight: root.scrollHeight,
    docWidth: root.scrollWidth,
    height: window.innerHeight,
    width: window.innerWidth,
    sideways: [...document.querySelectorAll<HTMLElement>('.shell-main')].some(
      (el) => el.scrollWidth > el.clientWidth + 1,
    ),
  };
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const) {
  test(`${size.width}x${size.height}: Health, the notice and the failing banner never scroll the page`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);

    // The notice says what is wrong on every screen, and the banner covers both runs.
    await page.goto('/leadgen');
    const notice = page.getByRole('alert', { name: 'Problem that needs attention' });
    await expect(notice).toContainText('Apify is out of credit');
    const banner = page.getByRole('alert', { name: /Problem with the run in/ });
    await expect(banner).toHaveCount(2);
    await expect(banner.nth(1)).toContainText('since 14:20 UTC');
    const dash = await page.evaluate(measure);
    expect(dash.docHeight).toBeLessThanOrEqual(dash.height);
    expect(dash.sideways).toBe(false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-${size.width}.png` });

    // Health: the notice's link opens the tab, and its content scrolls inside the panel.
    await notice.getByRole('link', { name: 'Open Health' }).click();
    await expect(page.getByRole('tab', { name: 'Health', selected: true })).toBeVisible();
    await expect(page.getByText('Apify (finds places and people)')).toBeVisible();
    const health = await page.evaluate(measure);
    expect(health.docHeight).toBeLessThanOrEqual(health.height);
    expect(health.sideways).toBe(false);
    const panel = page.getByRole('tabpanel');
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(21);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/health-${size.width}.png` });
  });
}
