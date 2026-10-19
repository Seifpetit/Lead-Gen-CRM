import { expect, test, type Page } from '@playwright/test';

// Every page is as tall as the window and never scrolls; only content areas inside cards do.
// The backend is real (sign-in), but the leads list is replaced with 100 leads so the Recent
// leads card has far more rows than fit.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

const leads = Array.from({ length: 100 }, (_, i) => ({
  id: `layout-lead-${i}`,
  runId: 'layout-run',
  company: {
    id: `layout-co-${i}`,
    name: `Layout Company ${String(i + 1).padStart(3, '0')} Transport SARL`,
    governorate: 'Sfax',
    sector: 'textile',
    googlePlaceId: `layout-place-${i}`,
    domain: `layout-${i}.example.test`,
    website: `https://layout-${i}.example.test`,
    phone: '+216 70 000 000',
    email: null,
    linkedinUrl: null,
    evidence: [],
  },
  contact: null,
  score: { companyFit: 40, contactFit: 20, reachability: 10, total: 90 - (i % 60) },
  crmStage: 'system_suggested',
}));

async function signIn(page: Page) {
  // Answer the lead list from here; every other request goes to the real backend.
  await page.route(
    (url) => url.pathname === '/api/leads',
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const limit = Number(query.get('limit') ?? 50);
      const offset = Number(query.get('offset') ?? 0);
      await route.fulfill({
        json: {
          items: leads.slice(offset, offset + limit),
          total: leads.length,
          limit,
          offset,
          nextOffset: offset + limit < leads.length ? offset + limit : null,
        },
      });
    },
  );
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** What a person would see as "the page scrolls": the document, sideways, or two scrollbars in one. */
function measure() {
  const root = document.documentElement;
  const scrollers = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
    const style = getComputedStyle(el);
    return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  });
  const nested = scrollers.flatMap((outer) =>
    scrollers
      .filter((inner) => inner !== outer && outer.contains(inner))
      .map((inner) => `${outer.className} > ${inner.className}`),
  );
  return {
    docHeight: root.scrollHeight,
    docWidth: root.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    height: window.innerHeight,
    width: window.innerWidth,
    nested,
    sideways: [...document.querySelectorAll<HTMLElement>('.shell-main')].some(
      (el) => el.scrollWidth > el.clientWidth + 1,
    ),
  };
}

const PAGES = [
  ['Dashboard', '/leadgen'],
  ['Coverage', '/leadgen/coverage'],
  ['Costs', '/leadgen/costs'],
  ['Logs', '/leadgen/logs'],
  ['Settings', '/leadgen/settings'],
  ['Help', '/leadgen/help'],
] as const;

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
  { width: 800, height: 560 },
  { width: 390, height: 844 },
] as const;

test('with 100 leads the page never scrolls, only the lists inside cards do', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/leadgen');

  const table = page.getByRole('table', { name: 'Recent leads' });
  await expect(table.getByRole('row')).toHaveCount(101);

  // The document does not scroll, and trying to scroll it moves nothing.
  const before = await page.evaluate(measure);
  expect(before.docHeight).toBeLessThanOrEqual(before.height);
  expect(before.bodyHeight).toBeLessThanOrEqual(before.height);
  expect(before.docWidth).toBeLessThanOrEqual(before.width);
  await page.mouse.move(700, 120);
  await page.mouse.wheel(0, 2000);
  expect(await page.evaluate(() => window.scrollY + document.documentElement.scrollTop)).toBe(0);

  // The list is the card's scroll area: more rows than fit, a header that stays, and the top
  // bar, sidebar and charts row do not move when it scrolls.
  const list = page.locator('.leads-card .table-scroll');
  const fits = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(fits).toBe(true);
  const visibleRows = await table.getByRole('row').evaluateAll((rows) => {
    const box = rows[0]!.closest('.table-scroll')!.getBoundingClientRect();
    return rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= box.top && b.bottom <= box.bottom;
    }).length;
  });
  expect(visibleRows).toBeGreaterThanOrEqual(5);
  const bar = await page.locator('.topbar').boundingBox();
  const side = await page.locator('.sidebar').boundingBox();
  const charts = await page.locator('.dash-bottom').boundingBox();
  await list.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  const header = await table.locator('thead th').first().boundingBox();
  const frame = await list.boundingBox();
  expect(Math.abs(header!.y - frame!.y)).toBeLessThan(3);
  expect(await page.locator('.topbar').boundingBox()).toEqual(bar);
  expect(await page.locator('.sidebar').boundingBox()).toEqual(side);
  expect(await page.locator('.dash-bottom').boundingBox()).toEqual(charts);
  // The charts row is about 240px tall.
  expect(charts!.height).toBeGreaterThan(220);
  expect(charts!.height).toBeLessThanOrEqual(241);
  const after = await page.evaluate(measure);
  expect(after.docHeight).toBeLessThanOrEqual(after.height);
  // No scroll area sits inside another one.
  expect(after.nested).toEqual([]);
});

for (const size of SIZES) {
  test(`${size.width}x${size.height}: no page scroll, no sideways scroll, no double scrollbar`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);
    for (const [title, path] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.locator('.state-loading')).toHaveCount(0);
      const m = await page.evaluate(measure);
      expect(m.docHeight, `${title}: document height`).toBeLessThanOrEqual(m.height);
      expect(m.bodyHeight, `${title}: body height`).toBeLessThanOrEqual(m.height);
      expect(m.docWidth, `${title}: document width`).toBeLessThanOrEqual(m.width);
      expect(m.sideways, `${title}: main panel sideways`).toBe(false);
      // On a short window the main panel may scroll around cards that keep a minimum height,
      // so lists inside cards can then sit in it; otherwise nothing nests.
      if (size.height >= 700 && size.width > 720) {
        expect(m.nested, `${title}: nested scroll areas`).toEqual([]);
      }
    }
  });
}
