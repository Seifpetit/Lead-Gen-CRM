import { expect, test, type Page } from '@playwright/test';

// Every page is as tall as the window and never scrolls; only content areas inside cards do.
// The backend is real (sign-in), but the lead list and the CRM cards are replaced with 100 leads
// so the Recent leads grid has far more cards than fit.

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

const cards = leads.map((lead, i) => ({
  id: `layout-card-${i}`,
  pipeline: 'companies',
  stage: 'found',
  stageEnteredAt: '2026-10-18T09:30:00.000Z',
  noiseAt: null,
  purgeAt: null,
  removedFrom: null,
  company: {
    id: lead.company.id,
    name: lead.company.name,
    sector: 'textile',
    website: lead.company.website,
    phone: lead.company.phone,
    email: null,
    imageUrl: null,
    imageSource: null,
    regionId: 'sfax',
    city: 'Sfax',
    category: 'Corporate office',
    location: null,
  },
  person: null,
  score: lead.score.total,
  foundAt: '2026-10-18T09:30:00.000Z',
  runId: 'layout-run',
  leadId: lead.id,
}));

async function signIn(page: Page) {
  // Answer the lead list and the cards from here; every other request goes to the real backend.
  await page.route(
    (url) => url.pathname === '/api/crm/companies/cards',
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const limit = Number(query.get('limit') ?? 50);
      const from = Number(query.get('cursor') ?? 0);
      await route.fulfill({
        json: {
          cards: cards.slice(from, from + limit),
          total: cards.length,
          nextCursor: from + limit < cards.length ? String(from + limit) : null,
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/crm/companies/facets',
    (route) =>
      route.fulfill({
        json: {
          total: cards.length,
          stages: [{ key: 'found', count: cards.length }],
          sectors: [{ id: 'textile', name: 'Textile', count: cards.length }],
          runs: [{ id: 'layout-run', count: cards.length }],
        },
      }),
  );
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
  ['Runs', '/leadgen/runs'],
  ['Runs', '/leadgen/runs?view=logs'],
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

test('with 100 leads the page never scrolls, only the card grid inside the panel does', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/leadgen');

  const tiles = page.locator('.tile-grid > .tile');
  await expect(tiles.first()).toBeVisible();
  await expect.poll(() => tiles.count()).toBeGreaterThanOrEqual(50);

  // The document does not scroll, and trying to scroll it moves nothing.
  const before = await page.evaluate(measure);
  expect(before.docHeight).toBeLessThanOrEqual(before.height);
  expect(before.bodyHeight).toBeLessThanOrEqual(before.height);
  expect(before.docWidth).toBeLessThanOrEqual(before.width);
  await page.mouse.move(700, 120);
  await page.mouse.wheel(0, 2000);
  expect(await page.evaluate(() => window.scrollY + document.documentElement.scrollTop)).toBe(0);

  // One panel: the leads take about 55% of it, the bottom row about 35%, the header is slim.
  const panel = (await page.locator('.dash-panel').boundingBox())!;
  const header = (await page.locator('.dp-header').boundingBox())!;
  const top = (await page.locator('.dp-leads').boundingBox())!;
  const charts = (await page.locator('.dp-bottom').boundingBox())!;
  expect(header.height).toBeLessThanOrEqual(60);
  expect(top.height / panel.height).toBeGreaterThan(0.45);
  expect(top.height / panel.height).toBeLessThan(0.65);
  expect(charts.height / panel.height).toBeGreaterThan(0.28);
  expect(charts.height / panel.height).toBeLessThan(0.42);

  // Four to five cards per row on a wide screen, and a few rows visible.
  const grid = page.locator('.tile-scroll');
  const columns = await tiles.evaluateAll(
    (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().left))).size,
  );
  expect(columns).toBeGreaterThanOrEqual(4);
  expect(columns).toBeLessThanOrEqual(5);
  const visible = await tiles.evaluateAll((els) => {
    const box = els[0]!.closest('.tile-scroll')!.getBoundingClientRect();
    return els.filter((el) => {
      const b = el.getBoundingClientRect();
      return b.top >= box.top && b.bottom <= box.bottom;
    }).length;
  });
  expect(visible).toBeGreaterThanOrEqual(2 * columns);

  // The grid is the scroll area: the top bar, sidebar and the bottom row do not move with it.
  expect(await grid.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const bar = await page.locator('.topbar').boundingBox();
  const side = await page.locator('.sidebar').boundingBox();
  await grid.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  expect(await page.locator('.topbar').boundingBox()).toEqual(bar);
  expect(await page.locator('.sidebar').boundingBox()).toEqual(side);
  expect(await page.locator('.dp-bottom').boundingBox()).toEqual(charts);
  const after = await page.evaluate(measure);
  expect(after.docHeight).toBeLessThanOrEqual(after.height);
  // No scroll area sits inside another one.
  expect(after.nested).toEqual([]);
});

test('the divider resizes the leads and the charts, and the cards hop under the pointer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/leadgen');
  await expect(page.locator('.tile-grid > .tile').first()).toBeVisible();
  const bar = page.getByRole('separator', { name: 'Resize leads and charts' });
  const before = (await page.locator('.dp-leads').boundingBox())!;
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 });
  await page.mouse.up();
  const after = (await page.locator('.dp-leads').boundingBox())!;
  expect(after.height).toBeLessThan(before.height - 80);
  // The page still does not scroll, and the divider keeps its place between the two.
  const m = await page.evaluate(measure);
  expect(m.docHeight).toBeLessThanOrEqual(m.height);
  // The keyboard moves it too.
  await bar.focus();
  await page.keyboard.press('End');
  await expect(bar).toHaveAttribute('aria-valuenow', '80');

  // A card lifts when hovered, and a drag moves it before another.
  const tiles = page.locator('.tile-grid > .tile');
  const second = tiles.nth(1);
  const at = (await second.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await expect.poll(() => second.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  const first = (await tiles.nth(0).boundingBox())!;
  const name = await second.locator('.tile-name').textContent();
  await page.mouse.move(at.x + 20, at.y + 20);
  await page.mouse.down();
  await page.mouse.move(first.x + 10, first.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(tiles.nth(0).locator('.tile-name')).toHaveText(name!);
});

test('Expand opens a window over about 95% of the screen, with the same cards, and Escape closes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/leadgen');
  await expect(page.locator('.tile-grid > .tile').first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recent leads' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width / 1440).toBeGreaterThan(0.9);
  expect(box.height / 900).toBeGreaterThan(0.9);
  await expect(dialog.getByRole('navigation', { name: 'Folders' })).toBeVisible();
  await expect(dialog.locator('.tile-grid > .tile').first()).toBeVisible();
  const m = await page.evaluate(measure);
  expect(m.docHeight).toBeLessThanOrEqual(m.height);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
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

test('the lead page is one card: the page stays still and a long evidence list scrolls inside', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  const long = Array.from({ length: 80 }, (_, i) => ({
    field: `raw${i}`,
    value: `raw value ${i}`,
    kind: 'fact',
    sourceUrl: 'https://source.example.test/page',
    fetchedAt: '2026-10-18T09:30:00.000Z',
  }));
  const lead = {
    ...leads[0]!,
    company: { ...leads[0]!.company, evidence: long },
  };
  const cardData = {
    card: {
      id: 'layout-card',
      pipeline: 'companies',
      stage: 'found',
      stageEnteredAt: '2026-10-18T09:30:00.000Z',
      noiseAt: null,
      purgeAt: null,
      removedFrom: null,
      company: {
        id: lead.company.id,
        name: lead.company.name,
        sector: 'textile',
        website: lead.company.website,
        phone: lead.company.phone,
        email: null,
        imageUrl: null,
        imageSource: null,
        regionId: 'sfax',
        city: 'Sfax',
        category: 'Corporate office',
        location: { lat: 34.74, lng: 10.76 },
      },
      person: null,
      score: 90,
    },
    sectorName: 'Textile',
    notes: '',
    history: [{ from: null, to: 'found', at: '2026-10-18T09:30:00.000Z' }],
    person: null,
  };
  await page.route('**/api/runs/layout-run', (route) =>
    route.fulfill({
      json: {
        id: 'layout-run',
        regionId: 'sfax',
        status: 'finished',
        leads: [lead],
        leadsTotal: 1,
        leadsNextOffset: null,
      },
    }),
  );
  await page.route('**/api/crm/cards/by-company/*', (route) => route.fulfill({ json: cardData }));

  for (const size of [
    { width: 1280, height: 720 },
    { width: 800, height: 600 },
    { width: 600, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/leadgen/runs/layout-run/leads/${lead.id}`);
    await expect(page.getByRole('heading', { level: 1, name: lead.company.name })).toBeVisible();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    const m = await page.evaluate(measure);
    expect(m.docHeight).toBeLessThanOrEqual(m.height);
    expect(m.docWidth).toBeLessThanOrEqual(m.width);
    expect(m.sideways).toBe(false);
    expect(m.nested).toEqual([]);
    // Narrow: the name wraps onto its own line, not cut short, and the header is not covered.
    if (size.width <= 640) {
      const h = await page.evaluate(() => {
        const head = document.querySelector('.lead-detail > .widget-header')!;
        const title = head.querySelector('h1')!;
        const r = head.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          cut: title.scrollWidth > title.clientWidth,
          covered: !head.contains(top),
          opacity: getComputedStyle(head).opacity,
        };
      });
      expect(h).toEqual({ cut: false, covered: false, opacity: '1' });
    }
  }

  // Wide: the evidence scrolls in the right column, the left column stays put.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('tab', { name: 'Evidence' }).click();
  const panel = page.locator('.lead-col-right [role="tabpanel"]');
  expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await panel.hover();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(await page.locator('.lead-col-left').evaluate((el) => el.scrollTop)).toBe(0);
});

// Logs and Costs with far more rows than fit: the rows and the table scroll inside the panel.
const logRuns = Array.from({ length: 40 }, (_, i) => ({
  run: {
    id: `layout-log-${i}`,
    region: ['sfax', 'bizerte', 'ben-arous', 'sousse'][i % 4],
    sectors: [],
    mode: 'normal',
    status: i === 0 ? 'running' : 'finished',
    currentStage: i === 0 ? 'discover' : null,
    budgetCapUsd: 2,
    spentUsd: 0.553,
    placesDroppedOutside: i % 4 === 1 ? 98 : 0,
    customOnly: false,
    customWordings: [],
    cellKeys: [],
    createdAt: new Date(Date.UTC(2026, 9, 19, 12) - i * 3_600_000).toISOString(),
    finishedAt:
      i === 0 ? null : new Date(Date.UTC(2026, 9, 19, 12) - i * 3_600_000 + 900_000).toISOString(),
    funnel: {
      discovered: i % 4 === 1 ? 0 : 30,
      skipped: 0,
      qualified: 10,
      rejected: 5,
      review: 0,
      unreachable: 0,
      peopleFound: 6,
      enriched: 5,
      scored: 5,
      leads: i % 4 === 1 ? 0 : 5,
    },
    error: null,
    liveMessage: '',
    stageFraction: 0,
  },
  steps: [],
}));

// Rows with the longest outcome labels, to check that no cell of a log row sits on another.
const outcomeRows = [
  { status: 'finished', placesDroppedOutside: 0, leads: 5, discovered: 30 },
  { status: 'finished', placesDroppedOutside: 98, leads: 0, discovered: 0 },
  { status: 'stopped_by_cap', placesDroppedOutside: 0, leads: 1, discovered: 1 },
  { status: 'running', placesDroppedOutside: 0, leads: 0, discovered: 0 },
].map((o, i) => {
  const base = logRuns[i + 1]!;
  return {
    ...base,
    run: {
      ...base.run,
      id: `layout-outcome-${i}`,
      region: 'ben-arous',
      status: o.status,
      currentStage: o.status === 'running' ? 'discover' : null,
      finishedAt: o.status === 'running' ? null : base.run.finishedAt,
      placesDroppedOutside: o.placesDroppedOutside,
      funnel: {
        ...base.run.funnel,
        discovered: o.discovered,
        leads: o.leads,
        ...(o.leads === 0 && o.discovered === 0
          ? { qualified: 0, review: 0, unreachable: 0, peopleFound: 0 }
          : {}),
      },
    },
  };
});
const costRows = Array.from({ length: 60 }, (_, i) => ({
  key: `layout-provider-${i}`,
  actualUsd: 1.5,
  openEstimateUsd: 0.25,
  totalUsd: 1.75,
  entries: 3,
}));

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const) {
  test(`${size.width}x${size.height}: Logs and Costs scroll only inside their panel`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);
    await page.route(
      (url) => url.pathname === '/api/apify/log',
      (route) =>
        route.fulfill({
          json: {
            runs: logRuns,
            attention: [],
            recent: { items: [], total: 0, limit: 50, offset: 0, nextOffset: null },
          },
        }),
    );
    await page.route(
      (url) => url.pathname === '/api/costs',
      (route) =>
        route.fulfill({
          json: { items: costRows, total: costRows.length, limit: 50, offset: 0, nextOffset: null },
        }),
    );

    await page.goto('/leadgen/runs?view=logs');
    const rows = page.locator('.logs-row');
    await expect(rows.first()).toBeVisible();
    const header = (await page.locator('.dp-header').boundingBox())!;
    expect(header.height).toBeLessThanOrEqual(60);
    const logs = await page.evaluate(measure);
    expect(logs.docHeight).toBeLessThanOrEqual(logs.height);
    expect(logs.nested).toEqual([]);
    expect(
      await page.locator('.logs-body').evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    // A row is one line high when the panel is wide enough and two lines below 1100px, and
    // Open log is pinned to its right edge.
    const row = (await rows.first().boundingBox())!;
    expect(row.height).toBeLessThan(size.width >= 1440 ? 80 : 110);
    const open = (await rows.first().locator('.logs-open').boundingBox())!;
    expect(row.x + row.width - (open.x + open.width)).toBeLessThan(24);

    await rows.first().locator('.logs-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Complete log')).toBeVisible();
    const opened = await page.evaluate(measure);
    expect(opened.docHeight).toBeLessThanOrEqual(opened.height);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.goto('/leadgen/costs');
    await expect(page.locator('.costs-body tbody tr').first()).toBeVisible();
    const costs = await page.evaluate(measure);
    expect(costs.docHeight).toBeLessThanOrEqual(costs.height);
    expect(costs.nested).toEqual([]);
    expect(
      await page.locator('.costs-body').evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    expect((await page.locator('.dp-header').boundingBox())!.height).toBeLessThanOrEqual(60);
  });
}

for (const width of [800, 1280, 1440, 1920]) {
  test(`${width}px: the cells of a log row never overlap and the badge is never clipped`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.route(
      (url) => url.pathname === '/api/apify/log',
      (route) =>
        route.fulfill({
          json: {
            runs: outcomeRows,
            attention: [],
            recent: { items: [], total: 0, limit: 50, offset: 0, nextOffset: null },
          },
        }),
    );
    await page.goto('/leadgen/runs?view=logs');
    const rows = page.locator('.logs-row');
    await expect(rows).toHaveCount(outcomeRows.length);
    const found = await rows.evaluateAll((els) =>
      els.map((row) => {
        const cells = [...row.children].map((c) => {
          const r = c.getBoundingClientRect();
          return { name: c.className, x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const overlaps: string[] = [];
        for (let a = 0; a < cells.length; a++) {
          for (let b = a + 1; b < cells.length; b++) {
            const p = cells[a]!;
            const q = cells[b]!;
            const across = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
            const down = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
            if (across > 0.5 && down > 0.5) overlaps.push(`${p.name} / ${q.name}`);
          }
        }
        // Text must also stay inside its own cell (a cell box can be fine while its words spill).
        const spilling = ['.logs-time', '.logs-spend', '.logs-actions', '.step-icons'].filter(
          (q) => {
            const el = row.querySelector<HTMLElement>(q)!;
            return el.scrollWidth > el.clientWidth + 1;
          },
        );
        const badge = row.querySelector<HTMLElement>('.badge-outcome')!;
        const slot = badge.parentElement!;
        const rowBox = row.getBoundingClientRect();
        const inside = cells.every((c) => c.x >= rowBox.x - 0.5 && c.x + c.w <= rowBox.right + 0.5);
        return {
          overlaps,
          spilling,
          inside,
          badgeLabel: badge.textContent,
          badgeClipped: badge.scrollWidth > badge.clientWidth,
          slotClipped: slot.scrollWidth > slot.clientWidth,
        };
      }),
    );
    for (const row of found) {
      expect(row.overlaps, row.badgeLabel ?? '').toEqual([]);
      expect(row.spilling, row.badgeLabel ?? '').toEqual([]);
      expect(row.badgeClipped, row.badgeLabel ?? '').toBe(false);
      expect(row.slotClipped, row.badgeLabel ?? '').toBe(false);
      expect(row.inside, row.badgeLabel ?? '').toBe(true);
    }
    const labels = found.map((r) => r.badgeLabel);
    expect(labels).toContain('Completed with leads');
    expect(labels).toContain('Ended, no results');
    expect(labels).toContain('Stopped by spend cap');
  });
}
