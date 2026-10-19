import { expect, test, type Page } from '@playwright/test';

// The Coverage panel with all 24 governorates and a busy matrix: the page never scrolls, the map
// stays where it is while the matrix scrolls, a pick zooms the map and turns the matrix into a
// table, and a click on the empty map puts it all back. Sign-in is real; the data is replaced.

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
  'mining',
].map((id) => ({ id, name: id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));

// 24 rectangles on a 6 x 4 grid over Tunisia; the last four have no bounds, as in the real data.
const REGIONS = Array.from({ length: 24 }, (_, i) => {
  const col = i % 6;
  const row = Math.floor(i / 6);
  const west = 8 + col * 0.6;
  const north = 37 - row * 1.5;
  return {
    regionId: `region-${i}`,
    name: `Region ${String(i + 1).padStart(2, '0')}`,
    bounds: i < 20 ? { south: north - 1.4, west, north, east: west + 0.55 } : (null as null),
    explored: i < 20,
  };
});

const square = (b: { south: number; west: number; north: number; east: number }) => ({
  type: 'Polygon',
  coordinates: [
    [
      [b.west, b.south],
      [b.east, b.south],
      [b.east, b.north],
      [b.west, b.north],
      [b.west, b.south],
    ],
  ],
});

const states = ['not_searched', 'yielding', 'saturated', 'maintenance'] as const;

async function signIn(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/coverage',
    (route) =>
      route.fulfill({
        json: {
          regions: REGIONS.map((r) => ({ regionId: r.regionId, name: r.name })),
          sectors: SECTORS,
          entries: REGIONS.slice(0, 12).flatMap((r, ri) =>
            SECTORS.map((s, si) => ({
              regionId: r.regionId,
              sectorId: s.id,
              queriesRun: (ri + si) % 5 === 0 ? 0 : 4 + si,
              newPlaces: ri + si,
              leads: (ri * 3 + si) % 11,
              spendUsd: ((ri + 1) * (si + 2)) / 10,
              costPerLeadUsd: 0.4,
              lastRunAt: '2026-10-10T09:00:00.000Z',
              state: states[(ri + si) % 4],
            })),
          ),
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/regions',
    (route) =>
      route.fulfill({
        json: {
          items: REGIONS.map((r, i) => ({
            regionId: r.regionId,
            name: r.name,
            hasBounds: r.bounds !== null,
            status: 'active',
            saturatedAt: null,
            cellsTotal: 10,
            cellsSearched: i < 12 ? 10 - (i % 10) : 0,
            cellsExhausted: 0,
            coverage: i < 12 ? (10 - (i % 10)) / 10 : null,
            queriesRun: 0,
            placesFound: 0,
            newPlacesPerQuery: null,
            qualifiedShare: null,
            decisionMakerShare: null,
            channelShare: null,
            spendUsd: 0,
            leads: i < 12 ? 5 : 0,
            costPerLeadUsd: null,
            runs: i < 12 ? 1 : 0,
            lastRunAt: null,
          })),
          total: 24,
          limit: 100,
          offset: 0,
          nextOffset: null,
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/regions/geometry',
    (route) =>
      route.fulfill({
        json: {
          items: REGIONS.map((r) => ({
            regionId: r.regionId,
            name: r.name,
            bounds: r.bounds,
            outline: r.bounds ? square(r.bounds) : null,
            outlineSource: r.bounds ? 'bounds' : null,
          })),
        },
      }),
  );
  await page.route(
    (url) => /^\/api\/regions\/region-\d+\/cells$/.test(url.pathname),
    (route) =>
      route.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0, nextOffset: null } }),
  );
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

const docFits = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight <= window.innerHeight &&
      document.documentElement.scrollWidth <= window.innerWidth,
  );

test('the matrix scrolls on its own while the map stays fixed, and a pick zooms the map', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await page.goto('/leadgen/coverage');
  const grid = page.getByRole('grid', { name: 'Coverage by sector' });
  await expect(grid).toBeVisible();
  expect(await docFits(page)).toBe(true);

  // About 60% / 40%, side by side.
  const left = (await page.locator('.cov-left').boundingBox())!;
  const right = (await page.locator('.cov-right').boundingBox())!;
  expect(left.width / (left.width + right.width)).toBeGreaterThan(0.55);
  expect(left.width / (left.width + right.width)).toBeLessThan(0.65);
  expect(right.x).toBeGreaterThan(left.x + left.width - 2);

  // All 24 regions are rows; the greyed ones come last.
  await expect(grid.getByRole('rowheader')).toHaveCount(25);
  await expect(grid.locator('tbody tr.is-grey')).toHaveCount(4);
  await expect(grid.locator('tbody tr').last()).toHaveClass(/is-grey/);

  // Scrolling the matrix moves it, not the map.
  const scroller = page.locator('.cov-left .cov-scroll');
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const mapBefore = await page.locator('.cov-map').boundingBox();
  await scroller.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(await page.locator('.cov-map').boundingBox()).toEqual(mapBefore);
  expect(await docFits(page)).toBe(true);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/matrix.png` });

  // Picking a region on the map turns the matrix into its table and zooms in.
  const svg = page.getByRole('group', { name: 'Coverage map' });
  const wide = await svg.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Region Region 03' }).click();
  await expect(page.getByRole('table', { name: 'Region 03 by sector' })).toBeVisible();
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(wide);
  await expect(page).toHaveURL(/region=region-2$/);
  expect(await docFits(page)).toBe(true);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/table.png` });

  // The empty map background resets everything.
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(grid).toBeVisible();
  await expect(page).not.toHaveURL(/region=/);
  await expect.poll(() => svg.getAttribute('viewBox')).toBe(wide);
});

test('Expand opens a window with a larger matrix and the history, and Escape closes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/leadgen/coverage');
  await page.getByRole('button', { name: 'Expand' }).click();
  const dialog = page.getByRole('dialog', { name: 'Coverage' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width / 1440).toBeGreaterThan(0.9);
  await expect(dialog.getByRole('tab', { name: 'History results' })).toBeVisible();
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/expand.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand' })).toBeFocused();
});

test('below 900px the matrix is on top and the map under it, with no page scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await signIn(page);
  await page.goto('/leadgen/coverage');
  await expect(page.getByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
  const left = (await page.locator('.cov-left').boundingBox())!;
  const right = (await page.locator('.cov-right').boundingBox())!;
  expect(right.y).toBeGreaterThanOrEqual(left.y + left.height - 3);
  expect(Math.abs(right.x - left.x)).toBeLessThan(4);
  expect(await docFits(page)).toBe(true);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/narrow.png` });
});
