import { expect, test, type Locator, type Page } from '@playwright/test';

// The Coverage world map in a real browser: a big draggable, zoomable map; the camera flies to a
// picked country; "Coverage by region" opens by itself and lights regions both ways; a pin opens
// a small panel with a button to its lead. Sign-in and countries are real; the pins are replaced.

const EMAIL = 'e2e@example.test';
const PASSWORD = 'e2e-password-123';

const PINS = [
  {
    companyId: 'c-fr',
    name: 'Maison Breizh Export',
    lat: 48.2,
    lng: -2.9,
    country: 'FR',
    regionId: 'fr-bretagne',
    sector: null,
    tradeRole: 'importer',
    category: 'Import-export company',
    city: 'Rennes',
    phone: '+33299000000',
    website: 'https://breizh.example.test',
    stage: 'found',
    score: 64,
    runId: 'run-1',
    leadId: 'lead-1',
  },
  {
    companyId: 'c-tn',
    name: 'Huilerie Baccar',
    lat: 34.74,
    lng: 10.76,
    country: 'TN',
    regionId: 'sfax',
    sector: null,
    tradeRole: 'exporter',
    category: 'Olive oil producer',
    city: 'Sfax',
    phone: null,
    website: null,
    stage: 'found',
    score: null,
    runId: null,
    leadId: null,
  },
];

async function signIn(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/map/pins',
    (route) => route.fulfill({ json: { items: PINS, total: PINS.length } }),
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

/** The Leaflet map behind the page, for working out where a place is on screen. */
const mapHost = (page: Page) => page.locator('.wm-host');
async function openMap(page: Page, query = '') {
  await page.goto(`/leadgen/coverage${query}`);
  await expect(mapHost(page)).toHaveAttribute('data-ready', 'true');
}
const view = (host: Locator) =>
  host.evaluate((el) => {
    const { map } = (el as unknown as { __worldMap: { map: import('leaflet').Map } }).__worldMap;
    return { zoom: map.getZoom(), lat: map.getCenter().lat, lng: map.getCenter().lng };
  });
/** Waits until the camera has been still for a moment (a flight to a country takes a second). */
async function settled(host: Locator) {
  let last = '';
  let since = Date.now();
  await expect
    .poll(async () => {
      const now = JSON.stringify(await view(host));
      if (now !== last) {
        last = now;
        since = Date.now();
      }
      return Date.now() - since > 900;
    })
    .toBe(true);
}
/** Page coordinates of a place. */
async function screenPoint(host: Locator, lat: number, lng: number) {
  const box = (await host.boundingBox())!;
  const p = await host.evaluate(
    (el, [la, ln]) => {
      const { map } = (el as unknown as { __worldMap: { map: import('leaflet').Map } }).__worldMap;
      const pt = map.latLngToContainerPoint([la!, ln!]);
      return { x: pt.x, y: pt.y };
    },
    [lat, lng],
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

test('opens on the whole world with one picker on the map and "Coverage by region" closed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await openMap(page);
  expect(await docFits(page)).toBe(true);

  // The map fills the panel and is draggable and zoomable.
  const host = mapHost(page);
  const box = (await host.boundingBox())!;
  expect(box.width).toBeGreaterThan(900);
  expect(box.height).toBeGreaterThan(500);
  await expect(page.getByRole('button', { name: /^Country: / })).toHaveCount(1);
  const head = page.getByRole('button', { name: /^Coverage by region/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  expect((await view(host)).zoom).toBeLessThanOrEqual(3);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/world.png` });

  const before = await view(host);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await view(host)).lng).toBeGreaterThan(before.lng + 5);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await view(host)).zoom).toBeGreaterThan(before.zoom);

  // Click: totals of every country, with the switched-off ones greyed.
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('region', { name: 'Coverage by region' });
  await expect(panel.getByRole('button', { name: /^Tunisia/ })).toBeEnabled();
  await expect(panel.getByRole('button', { name: /^Germany/ })).toBeDisabled();
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/world-open.png` });
});

test('picking France flies there, opens its regions, and lights a region and its row together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await openMap(page);
  const host = mapHost(page);

  await page.getByRole('button', { name: /^Country: / }).click();
  await page
    .getByRole('list', { name: 'Country' })
    .getByRole('button', { name: /^France/ })
    .click();
  await expect(page).toHaveURL(/focus=FR/);
  await expect
    .poll(async () => {
      const v = await view(host);
      return v.lat > 43 && v.lat < 50 && v.lng > -4 && v.lng < 7;
    })
    .toBe(true);
  const panelHead = page.getByRole('button', { name: /^Coverage by region: France/ });
  await expect(panelHead).toHaveAttribute('aria-expanded', 'true');
  await settled(host);
  const rows = page.locator('.wm-row[data-region]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(10);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/france.png` });

  // Hovering Brittany on the map lights its row; hovering the row lights the region.
  const bretagne = page.locator('.wm-row[data-region="fr-bretagne"]');
  // A spot inside Brittany that is not under its pin.
  const at = await screenPoint(host, 48.0, -3.6);
  await page.mouse.move(at.x, at.y);
  await expect(bretagne).toHaveClass(/is-hot/);
  await page.mouse.move(at.x + 5, at.y + 5);
  await bretagne.hover();
  await expect(bretagne).toHaveClass(/is-hot/);

  // Clicking the region picks it: details and a run button appear, the address remembers.
  await page.mouse.move(at.x, at.y);
  const wide = (await view(host)).zoom;
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/region=fr-bretagne/);
  // The camera moves in on the region.
  await expect.poll(async () => (await view(host)).zoom).toBeGreaterThan(wide + 0.8);
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Start a run in / })).toBeEnabled();
  expect(await docFits(page)).toBe(true);
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/region.png` });

  // Escape steps back: first the region, then the country.
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/region=/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/focus=/);
  await expect.poll(async () => (await view(host)).zoom).toBeLessThanOrEqual(3);
});

test('clicking a pin springs a small panel open, with a button to the lead', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await openMap(page, '?focus=FR');
  const host = mapHost(page);
  await expect.poll(async () => (await view(host)).lat).toBeGreaterThan(43);
  await settled(host);

  const at = await screenPoint(host, 48.2, -2.9);
  // The pin and a region are under the same spot; a pin wins.
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const panel = page.getByRole('region', { name: 'Details of Maison Breizh Export' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Score 64')).toBeVisible();
  // It springs open with an animation (scale past 1 and back).
  const animated = await panel.evaluate((el) =>
    el.getAnimations().some((a) => (a as CSSAnimation).animationName === 'wm-pop'),
  );
  expect(animated).toBe(true);
  // It stays on the map.
  const mapBox = (await host.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(mapBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 1);
  expect(panelBox.y).toBeGreaterThanOrEqual(mapBox.y - 1);
  if (process.env.COVERAGE_SHOTS) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/pin.png` });
  }

  // Dragging the map moves the panel with the pin.
  // First let the panel come to rest (opening a pin may nudge the camera).
  let rest = -1;
  let still = 0;
  await expect
    .poll(async () => {
      const x = (await panel.boundingBox())!.x;
      still = x === rest ? still + 1 : 0;
      rest = x;
      return still;
    })
    .toBeGreaterThanOrEqual(4);
  const first = await panel.boundingBox();
  await page.mouse.move(mapBox.x + 900, mapBox.y + 450);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 940, mapBox.y + 450, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeGreaterThan(first!.x + 20);

  await panel.getByRole('link', { name: 'Open the lead' }).click();
  await expect(page).toHaveURL(/\/leadgen\/runs\/run-1\/leads\/lead-1/);
});

test('a country the app does not work in does nothing when clicked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await openMap(page);
  const host = mapHost(page);
  const germany = await screenPoint(host, 51.0, 10.3);
  await page.mouse.click(germany.x, germany.y);
  await expect(page).not.toHaveURL(/focus=/);
  // France is one the app works in: clicking it flies there.
  const france = await screenPoint(host, 45.0, 2.5);
  await page.mouse.click(france.x, france.y);
  await expect(page).toHaveURL(/focus=FR/);
});

test('on a phone the map still fills the window with nothing scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openMap(page);
  expect(await docFits(page)).toBe(true);
  await expect(page.getByRole('button', { name: /^Coverage by region/ })).toBeVisible();
  if (process.env.COVERAGE_SHOTS)
    await page.screenshot({ path: `${process.env.COVERAGE_SHOTS}/narrow.png` });
});
