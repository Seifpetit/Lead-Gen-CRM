import { DEV_LIMITS, type DevHistoryEntry } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { AuthService, DEFAULT_POLICY } from '../auth/service.js';
import { buildApp } from '../app.js';
import type { Db } from '../data/db.js';
import { createRegionGrid } from '../data/regionCells.js';
import { setRegionBounds } from '../data/regions.js';
import { setMonthlyCap } from '../data/userBudget.js';
import { openTestDb, resetData } from '../data/testDb.js';
import type { Bounds } from '../lib/geo.js';
import { mapsInput } from '../providers/googleMapsApify.js';
import { DevConsole } from '../runner/devConsole.js';
import { FakeCompanyClassifier } from '../test/fakeClassifiers.js';
import { fakeProviders, type FakeApifyOptions } from '../test/fakeProviders.js';
import { testRunner } from '../test/testRunner.js';
import { CSRF_HEADER } from './csrf.js';

// The developer console: closed unless DEV_CONSOLE is on and the dev admin asks, limits held by
// the server, an estimate that never spends, one ledger row and one history row per paid call,
// and nothing saved to companies, coverage or the CRM. Fake providers only: no real call.

const SFAX: Bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };
const SECRET = 'super-secret-token-0123';
const PASSWORD = 'correct horse battery';

let db: Db;
const apps: FastifyInstance[] = [];
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

interface Who {
  token: string;
  csrf: string;
}

async function setup(
  opts: { apify?: FakeApifyOptions; console?: boolean; classifier?: boolean } = {},
) {
  const auth = new AuthService(db, { ...DEFAULT_POLICY, devAdminLogin: true });
  const fake = fakeProviders({ polls: 1, ...opts.apify });
  const classifier =
    opts.classifier === false
      ? null
      : new FakeCompanyClassifier({ 'Huile SA': 'exporter' }, { fallback: 'not_import_export' });
  const devConsole = new DevConsole({
    db,
    discovery: fake.discovery,
    buildRequest: mapsInput,
    classifier,
    classifierModel: 'claude-haiku-5-5',
    secrets: [SECRET],
    pollMs: 0,
  });
  const app = await buildApp({
    db,
    auth,
    runner: testRunner(db).runner,
    paidRunsEnabled: true,
    devConsole: opts.console === false ? null : devConsole,
  });
  apps.push(app);
  const login = async (email: string, password: string): Promise<Who> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(204);
    const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const csrf = (
      await app.inject({
        method: 'GET',
        url: '/api/auth/csrf',
        cookies: { [SESSION_COOKIE]: token },
      })
    ).json().token as string;
    return { token, csrf };
  };
  const admin = await login('test', 'test');
  const user = await login('alice@example.com', PASSWORD);
  const call = (
    who: Who | null,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      headers: who ? { [CSRF_HEADER]: who.csrf } : {},
    });
  return { app, admin, user, call, devConsole, fake, auth };
}

const discover = (over: Record<string, unknown> = {}) => ({
  step: 'discover',
  input: {
    country: 'TN',
    language: 'fr',
    words: ['huile d’olive'],
    area: { kind: 'cell', regionId: 'sfax', cellKey: 'r0c0' },
    maxPlaces: 5,
    capUsd: 0.5,
    ...over,
  },
});
const classify = (over: Record<string, unknown> = {}) => ({
  step: 'classify',
  input: {
    country: 'TN',
    companies: [{ name: 'Huile SA', category: 'Huilerie' }],
    capUsd: 0.1,
    ...over,
  },
});

async function counts() {
  const out: Record<string, number> = {};
  for (const t of [
    'companies',
    'contacts',
    'crm_leads',
    'crm_cards',
    'region_coverage',
    'search_queries',
    'run_steps',
    'run_companies',
    'cost_ledger',
    'dev_steps',
  ]) {
    out[t] = (await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM ${t}`)).rows[0]!.n;
  }
  out.searchRuns = (
    await db.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM runs WHERE kind <> 'dev_step'`,
    )
  ).rows[0]!.n;
  return out;
}

beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  await setRegionBounds(db, 'sfax', SFAX);
  await createRegionGrid(db, 'sfax', SFAX, 1, 2);
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function createUsers() {
  // Created by the same admin path the CLI uses; the dev login needs the flag, so it is made first.
  const auth = new AuthService(db, { ...DEFAULT_POLICY, devAdminLogin: true });
  await auth.createUserAsAdmin('test', 'test');
  await auth.createUserAsAdmin('alice@example.com', PASSWORD);
}

describe('access', () => {
  it('has no routes at all when DEV_CONSOLE is off', async () => {
    await createUsers();
    const s = await setup({ console: false });
    for (const [method, url] of [
      ['GET', '/api/dev/console/options'],
      ['POST', '/api/dev/console/estimate'],
      ['POST', '/api/dev/console/run'],
      ['GET', '/api/dev/console/history'],
    ] as const) {
      const res = await s.call(s.admin, method, url, method === 'POST' ? discover() : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await s.call(s.admin, 'GET', '/api/auth/me')).json().devConsole).toBe(false);
  });

  it('answers 404 to anyone but the dev admin, and 401 to nobody signed in', async () => {
    await createUsers();
    const s = await setup();
    expect((await s.call(s.user, 'GET', '/api/dev/console/options')).statusCode).toBe(404);
    expect((await s.call(s.user, 'POST', '/api/dev/console/run', discover())).statusCode).toBe(404);
    expect((await s.call(null, 'GET', '/api/dev/console/options')).statusCode).toBe(401);
    expect((await s.call(s.admin, 'GET', '/api/dev/console/options')).statusCode).toBe(200);
    expect((await s.call(s.admin, 'GET', '/api/auth/me')).json().devConsole).toBe(true);
    expect((await s.call(s.user, 'GET', '/api/auth/me')).json().devConsole).toBe(false);
  });

  it('offers the countries, the real cells and the limits', async () => {
    await createUsers();
    const s = await setup();
    const options = (await s.call(s.admin, 'GET', '/api/dev/console/options')).json();
    expect(options.limits).toEqual(DEV_LIMITS);
    expect(options.classifierConfigured).toBe(true);
    const sfax = options.areas.find((a: { regionId: string }) => a.regionId === 'sfax');
    expect(sfax.cells.map((c: { cellKey: string }) => c.cellKey)).toEqual(['r0c0', 'r0c1']);
    expect(sfax.bounds).toEqual(SFAX);
  });
});

describe('limits the server holds', () => {
  it.each([
    ['six words', discover({ words: ['a', 'b', 'c', 'd', 'e', 'f'] })],
    ['no words', discover({ words: [] })],
    ['21 places a search', discover({ maxPlaces: 21 })],
    ['a cap under the Apify minimum', discover({ capUsd: 0.25 })],
    ['a cap over $1', discover({ capUsd: 1.01 })],
    [
      'a rectangle upside down',
      discover({ area: { kind: 'rect', south: 35, west: 10, north: 34, east: 11 } }),
    ],
    [
      '21 companies',
      classify({ companies: Array.from({ length: 21 }, (_, i) => ({ name: `C${i}` })) }),
    ],
    ['a classify cap over $0.50', classify({ capUsd: 0.51 })],
    ['an unknown field', classify({ extra: true })],
  ])('refuses %s', async (_name, payload) => {
    await createUsers();
    const s = await setup();
    const before = await counts();
    const res = await s.call(s.admin, 'POST', '/api/dev/console/run', payload);
    expect(res.statusCode).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('refuses a region of another country and a cell that does not exist', async () => {
    await createUsers();
    const s = await setup();
    const wrong = await s.call(
      s.admin,
      'POST',
      '/api/dev/console/run',
      discover({ country: 'FR' }),
    );
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('wrong_country');
    const cell = await s.call(
      s.admin,
      'POST',
      '/api/dev/console/run',
      discover({ area: { kind: 'cell', regionId: 'sfax', cellKey: 'r9c9' } }),
    );
    expect(cell.json().error).toBe('unknown_area');
  });

  it('does not start a second call while one runs', async () => {
    await createUsers();
    const s = await setup({ apify: { polls: 3 } });
    // Two clicks at once: one is accepted, the other is told to wait.
    const both = await Promise.all([
      s.call(s.admin, 'POST', '/api/dev/console/run', discover()),
      s.call(s.admin, 'POST', '/api/dev/console/run', discover()),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    expect(both.find((r) => r.statusCode === 409)!.json().error).toBe('already_running');
    await s.devConsole.whenFinished((await userOf(s.admin)) as never);
  });

  it('refuses to start once the monthly cap is reached', async () => {
    await createUsers();
    const s = await setup();
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    const id = await userOf(s.admin);
    await s.devConsole.whenFinished(id as never);
    await setMonthlyCap(db, id as never, new Date(), 0.001);
    const res = await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('monthly_cap_reached');
  });
});

async function userOf(who: Who): Promise<string> {
  void who;
  return (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'test'`)).rows[0]!.id;
}

describe('estimate', () => {
  it('never spends and writes nothing', async () => {
    await createUsers();
    const s = await setup();
    const before = await counts();
    const res = await s.call(s.admin, 'POST', '/api/dev/console/estimate', discover());
    expect(res.statusCode).toBe(200);
    const est = res.json();
    expect(est.estimateUsd).toBeGreaterThan(0);
    expect(est.searches).toBe(1);
    expect(s.fake.apify.starts).toHaveLength(0);
    expect(await counts()).toEqual(before);
  });

  it('shows the exact request the real adapter builds, one per word', async () => {
    await createUsers();
    const s = await setup();
    const res = await s.call(
      s.admin,
      'POST',
      '/api/dev/console/estimate',
      discover({ words: ['importateur', 'grossiste alimentaire'] }),
    );
    const bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.7 };
    const query = (textQuery: string) => ({
      regionId: 'sfax',
      cellKey: 'r0c0',
      bounds,
      sectorId: null,
      textQuery,
      normalizedQuery: textQuery,
      languageCode: 'fr' as const,
      maxPlaces: 5,
    });
    expect(res.json().requests).toEqual([
      mapsInput(query('importateur')),
      mapsInput(query('grossiste alimentaire')),
    ]);
  });

  it('prices a classify call and names the question', async () => {
    await createUsers();
    const s = await setup();
    const est = (await s.call(s.admin, 'POST', '/api/dev/console/estimate', classify())).json();
    expect(est.estimateUsd).toBeGreaterThan(0);
    expect(est.requests[0]).toContain('import or export');
  });
});

describe('running a step', () => {
  async function finished(s: Awaited<ReturnType<typeof setup>>) {
    await s.devConsole.whenFinished((await userOf(s.admin)) as never);
    return (await s.call(s.admin, 'GET', '/api/dev/console/history')).json()
      .items as DevHistoryEntry[];
  }

  it('writes one history row and one ledger row on a hidden run, and nothing else', async () => {
    await createUsers();
    const s = await setup();
    const before = await counts();
    const res = await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    expect(res.statusCode).toBe(202);
    const [entry] = await finished(s);
    expect(entry!.status).toBe('succeeded');
    expect(entry!.costUsd).toBeGreaterThan(0);

    const after = await counts();
    expect(after.dev_steps).toBe(before.dev_steps! + 1);
    expect(after.cost_ledger).toBe(before.cost_ledger! + 1);
    // Not a company, contact, lead, card, coverage row, search query, step or search run.
    for (const table of [
      'companies',
      'contacts',
      'crm_leads',
      'crm_cards',
      'region_coverage',
      'search_queries',
      'run_steps',
      'run_companies',
      'searchRuns',
    ]) {
      expect(after[table], table).toBe(before[table]);
    }
    const run = await db.query<{ kind: string; status: string }>(
      `SELECT r.kind, r.status FROM runs r JOIN cost_ledger l ON l.run_id = r.id`,
    );
    expect(run.rows).toEqual([{ kind: 'dev_step', status: 'finished' }]);
  });

  it('does not show in the runs list, and shows in Costs as a console call', async () => {
    await createUsers();
    const s = await setup();
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    await finished(s);
    expect((await s.call(s.admin, 'GET', '/api/runs')).json().items).toEqual([]);
    const costs = (await s.call(s.admin, 'GET', '/api/costs?groupBy=run')).json();
    expect(costs.items).toHaveLength(1);
    expect(costs.items[0].runKind).toBe('dev_step');
  });

  it('reports places, counts and the outside-region flag the way a run judges them', async () => {
    await createUsers();
    // Place 0 is in Tunis (outside Sfax), place 1 is in Sfax.
    const s = await setup({
      apify: {
        placesPerCell: () => 2,
        locationOf: (_cell, i) => (i === 0 ? { lat: 36.8, lng: 10.18 } : { lat: 34.75, lng: 10.6 }),
      },
    });
    // The second place is one this user already has.
    const u = await userOf(s.admin);
    await db.query(
      `INSERT INTO companies (user_id, name, normalized_name, governorate, google_place_id)
       VALUES ($1, 'Known', 'known', 'sfax', 'fake-place-r0c0x1')`,
      [u],
    );
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevDiscoverOutput;
    expect(out.counts).toEqual({
      returned: 2,
      new: 0,
      outsideRegion: 1,
      alreadyKnown: 1,
      noContact: 0,
    });
    expect(out.places.map((p) => [p.outsideRegion, p.alreadyKnown])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(out.searches[0]!.apifyRunId).toMatch(/^fakeRun/);
    expect(out.searches[0]!.apifyRunUrl).toContain('console.apify.com');
    expect(out.requests).toEqual([
      mapsInput({
        regionId: 'sfax',
        cellKey: 'r0c0',
        bounds: { south: 34.6, west: 10.5, north: 34.9, east: 10.7 },
        sectorId: null,
        textQuery: 'huile d’olive',
        normalizedQuery: 'huile d’olive',
        languageCode: 'fr',
        maxPlaces: 5,
      }),
    ]);
  });

  it('says plainly when nothing comes back', async () => {
    await createUsers();
    const s = await setup({ apify: { placesPerCell: () => 0 } });
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevDiscoverOutput;
    expect(out.counts.returned).toBe(0);
    expect(out.notice).toContain('returned 0 places');
    expect(out.requests).toHaveLength(1);
  });

  it('searches every word and stops when the cap leaves too little', async () => {
    await createUsers();
    const s = await setup({ apify: { placesPerCell: () => 1 } });
    await s.call(
      s.admin,
      'POST',
      '/api/dev/console/run',
      discover({ words: ['un', 'deux', 'trois'], capUsd: 1 }),
    );
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevDiscoverOutput;
    expect(out.searches.map((x) => x.word)).toEqual(['un', 'deux', 'trois']);
    expect(s.fake.apify.starts).toHaveLength(3);

    // With a cap below what Apify needs to start a search, nothing is started.
    const low = await setup();
    await setMonthlyCap(db, (await userOf(low.admin)) as never, new Date(), 0.2);
    // (the month leaves $0.20 < $0.50 minimum, so the first word is not even started)
    await low.call(low.admin, 'POST', '/api/dev/console/run', discover());
    const [stopped] = await finished(low);
    const o2 = stopped!.output as import('@lead-gen-crm/shared').DevDiscoverOutput;
    expect(low.fake.apify.starts).toHaveLength(0);
    expect(o2.skippedWords).toEqual(['huile d’olive']);
    expect(o2.notice).toContain('at least');
  });

  it('with a $0.50 cap only the first word can start, and the estimate says so', async () => {
    await createUsers();
    const s = await setup({ apify: { placesPerCell: () => 1 } });
    const words = ['un', 'deux', 'trois'];
    const est = (
      await s.call(s.admin, 'POST', '/api/dev/console/estimate', discover({ words, capUsd: 0.5 }))
    ).json();
    expect(est.notice).toContain('only the first 1 of 3 words');
    const full = (
      await s.call(s.admin, 'POST', '/api/dev/console/estimate', discover({ words, capUsd: 1 }))
    ).json();
    expect(full.notice).toBeNull();

    await s.call(s.admin, 'POST', '/api/dev/console/run', discover({ words, capUsd: 0.5 }));
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevDiscoverOutput;
    expect(out.searches.map((x) => x.word)).toEqual(['un']);
    expect(out.skippedWords).toEqual(['deux', 'trois']);
    expect(out.notice).toContain('at least');
  });

  it('hides secrets in what it stores', async () => {
    await createUsers();
    const s = await setup();
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover({ words: [`olive ${SECRET}`] }));
    await finished(s);
    const rows = await db.query<{ input: unknown; output: unknown }>(
      'SELECT input, output FROM dev_steps',
    );
    expect(JSON.stringify(rows.rows)).not.toContain(SECRET);
    const body = JSON.stringify((await s.call(s.admin, 'GET', '/api/dev/console/history')).json());
    expect(body).not.toContain(SECRET);
  });

  it('classifies companies and records the cost on a hidden run', async () => {
    await createUsers();
    const s = await setup();
    const before = await counts();
    const res = await s.call(
      s.admin,
      'POST',
      '/api/dev/console/run',
      classify({
        companies: [
          { name: 'Huile SA', category: 'Huilerie', website: 'https://huile.example' },
          { name: 'Café du coin', text: 'bar' },
        ],
      }),
    );
    expect(res.statusCode).toBe(202);
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevClassifyOutput;
    expect(out.rows.map((r) => [r.name, r.tradeRole])).toEqual([
      ['Huile SA', 'exporter'],
      ['Café du coin', 'not_import_export'],
    ]);
    expect(out.rows[0]!.evidence).toContain('Huile SA');
    expect(out.system).toContain('import or export');
    const after = await counts();
    expect(after.cost_ledger).toBe(before.cost_ledger! + 2);
    expect(after.companies).toBe(before.companies);
    expect(after.searchRuns).toBe(before.searchRuns);
  });

  it('asks about the partner country for France', async () => {
    await createUsers();
    const s = await setup();
    await s.call(s.admin, 'POST', '/api/dev/console/run', classify({ country: 'FR' }));
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevClassifyOutput;
    expect(out.system).toContain('Tunisia');
  });

  it('stops classifying when the cap is reached', async () => {
    await createUsers();
    const s = await setup();
    await s.call(
      s.admin,
      'POST',
      '/api/dev/console/run',
      classify({
        capUsd: 0.0015,
        companies: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      }),
    );
    const [entry] = await finished(s);
    const out = entry!.output as import('@lead-gen-crm/shared').DevClassifyOutput;
    expect(out.rows).toHaveLength(2);
    expect(out.skipped).toBe(1);
    expect(out.notice).toContain('cap');
  });

  it('refuses classifying without a classifier key', async () => {
    await createUsers();
    const s = await setup({ classifier: false });
    const res = await s.call(s.admin, 'POST', '/api/dev/console/run', classify());
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('classifier_not_configured');
  });
});

describe('history', () => {
  it('lists newest first by step, opens one, and clears only this user’s history', async () => {
    await createUsers();
    const s = await setup();
    const id = await userOf(s.admin);
    await s.call(s.admin, 'POST', '/api/dev/console/run', discover());
    await s.devConsole.whenFinished(id as never);
    await s.call(s.admin, 'POST', '/api/dev/console/run', classify());
    await s.devConsole.whenFinished(id as never);

    const all = (await s.call(s.admin, 'GET', '/api/dev/console/history')).json().items;
    expect(all.map((e: DevHistoryEntry) => e.step)).toEqual(['classify', 'discover']);
    const only = (await s.call(s.admin, 'GET', '/api/dev/console/history?step=discover')).json()
      .items;
    expect(only).toHaveLength(1);
    const one = (await s.call(s.admin, 'GET', `/api/dev/console/history/${only[0].id}`)).json();
    expect(one.input.words).toEqual(['huile d’olive']);
    expect(one.by).toBe('test');

    // Another admin-less user's rows are not touched, and the ledger is never cleared.
    await db.query(
      `INSERT INTO dev_steps (user_id, step, status, input)
       SELECT id, 'discover', 'succeeded', '{}' FROM users WHERE email = 'alice@example.com'`,
    );
    const ledger = (await counts()).cost_ledger;
    expect((await s.call(s.admin, 'DELETE', '/api/dev/console/history')).statusCode).toBe(204);
    expect((await s.call(s.admin, 'GET', '/api/dev/console/history')).json().items).toEqual([]);
    expect((await counts()).dev_steps).toBe(1);
    expect((await counts()).cost_ledger).toBe(ledger);
  });

  it('marks a call that was running when the server stopped as failed', async () => {
    await createUsers();
    const s = await setup();
    const u = await userOf(s.admin);
    await db.query(
      `INSERT INTO dev_steps (user_id, step, status, input) VALUES ($1, 'discover', 'running', '{}')`,
      [u],
    );
    const items = (await s.call(s.admin, 'GET', '/api/dev/console/history')).json().items;
    expect(items[0].status).toBe('failed');
    expect(items[0].error).toContain('server stopped');
  });
});
