import { expect, test, type Page } from '@playwright/test';

// The live run views in a real browser: the Dashboard strip, the Runs page with two runs side by
// side, and the terminal-style log window. Sign-in goes to the real backend; the runs, their
// event stream and their log are answered here so the page has two runs in progress to show.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';
const SHOTS = process.env.LIVE_SHOTS;

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
const liveRun = (id: string, region: string, sentence: string, currentStage: string) => ({
  id,
  region,
  sectors: [],
  mode: 'normal',
  status: 'running',
  currentStage,
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
  liveMessage: sentence,
  stageFraction: 0.5,
});
const RUNS = [
  liveRun('live-a', 'Ben Arous', 'Looking up the people who work there...', 'find_people'),
  liveRun('live-b', 'Sfax', 'Found 24 companies, checking which ones move goods...', 'qualify'),
];
const LOG_LINES = Array.from({ length: 3_000 }, (_, i) => ({
  id: i + 1,
  at: new Date(Date.UTC(2026, 9, 19, 10, 0, 0) + i * 1_000).toISOString(),
  level: i % 400 === 399 ? 'warn' : 'info',
  message: `line ${i + 1}`,
  technical: i % 3 === 0,
}));

async function setUp(page: Page) {
  // The stream is refused, which makes the page use its every-3-seconds fallback.
  await page.route('**/api/runs/stream', (route) => route.abort());
  await page.route('**/api/runs/live', (route) => route.fulfill({ json: { runs: RUNS } }));
  // The runs here are made up, so the real backend has no leads for them.
  await page.route(
    (url) => url.pathname === '/api/leads',
    (route) =>
      route.fulfill({ json: { items: [], total: 0, limit: 25, offset: 0, nextOffset: null } }),
  );
  await page.route(/\/api\/runs\/live-[ab]\/logs/, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const after = Number(query.get('after') ?? 0);
    const limit = Number(query.get('limit') ?? 500);
    const rest = LOG_LINES.filter((l) => l.id > after);
    return route.fulfill({ json: { items: rest.slice(0, limit), hasMore: rest.length > limit } });
  });
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** What a person would see as "the page scrolls": the document or the main area, sideways too. */
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

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
] as const;

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the strip and the Runs page fit the window`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await setUp(page);

    await page.goto('/leadgen');
    const strip = page.getByRole('region', { name: 'Runs in progress' });
    await expect(strip.getByRole('listitem')).toHaveCount(2);
    await expect(strip.getByRole('progressbar')).toHaveCount(2);
    let m = await page.evaluate(measure);
    expect(m.docHeight, 'dashboard height').toBeLessThanOrEqual(m.height);
    expect(m.docWidth, 'dashboard width').toBeLessThanOrEqual(m.width);
    expect(m.sideways, 'dashboard sideways').toBe(false);
    // The leads still get room under the strip.
    const stripBox = (await strip.boundingBox())!;
    expect(stripBox.height).toBeLessThan(size.width < 700 ? 200 : 110);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-dash-${size.width}.png` });

    await page.goto('/leadgen/runs');
    const now = page.getByRole('region', { name: 'Running now' });
    const cards = now.locator('.run-card');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.state-loading')).toHaveCount(0);
    m = await page.evaluate(measure);
    expect(m.docHeight, 'runs height').toBeLessThanOrEqual(m.height);
    expect(m.docWidth, 'runs width').toBeLessThanOrEqual(m.width);
    expect(m.sideways, 'runs sideways').toBe(false);
    const a = (await cards.nth(0).boundingBox())!;
    const b = (await cards.nth(1).boundingBox())!;
    if (size.width >= 1280) {
      // Side by side on a wide screen.
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width - 2);
    } else if (size.width < 700) {
      // Stacked on a narrow one.
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 2);
    }
    // The leads area below keeps its place on screen.
    const results = (await page.getByRole('region', { name: 'Results' }).boundingBox())!;
    expect(results.y + results.height).toBeLessThanOrEqual(size.height + 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-runs-${size.width}.png` });
  });
}

test('the log window shows a long log without drawing it all, follows the end and can pause', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setUp(page);
  await page.goto('/leadgen/runs');
  const card = page.locator('.run-card', { hasText: 'Looking up the people' });
  const opener = card.getByRole('button', { name: 'Open all logs' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'All logs: run in Ben Arous' });
  await expect(dialog).toBeVisible();
  const term = dialog.getByRole('log', { name: 'Log lines' });
  // It ends on the newest line, and only the lines near the view are in the page.
  await expect(term.locator('.term-row', { hasText: /^.*line 3000$/ })).toBeVisible();
  expect(await term.locator('.term-row').count()).toBeLessThan(120);
  await expect(dialog.getByText('Following the latest line')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
  // Monospace on a dark panel.
  expect(await term.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /mono|Consolas|Menlo/i,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}-logs.png` });

  // Scrolling up pauses; Jump to latest comes back.
  await term.evaluate((el) => {
    el.scrollTop = 0;
  });
  const jump = dialog.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toBeVisible();
  await expect(term.locator('.term-row', { hasText: /^.*line 1$/ })).toBeVisible();
  await jump.click();
  await expect(term.locator('.term-row', { hasText: /^.*line 3000$/ })).toBeVisible();
  await expect(jump).toHaveCount(0);

  // Filter and search.
  await dialog.getByRole('radio', { name: 'Warnings and errors' }).check({ force: true });
  await expect(dialog.getByText('7 of 3000 lines')).toBeVisible();
  await dialog.getByRole('radio', { name: 'All' }).check({ force: true });
  await dialog.getByRole('searchbox', { name: 'Search the log' }).fill('line 2999');
  await expect(term.locator('.term-row')).toHaveCount(1);

  // The window stays inside the screen, and Escape closes it and gives focus back.
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
