import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { AuthService, DEFAULT_POLICY } from '../auth/service.js';
import { buildApp } from '../app.js';
import { listLiveClaims } from '../data/cellClaims.js';
import { upsertContact } from '../data/contacts.js';
import { upsertLead } from '../data/crmLeads.js';
import type { Db } from '../data/db.js';
import type { CoverageEntry } from '@lead-gen-crm/shared';
import type { UserId } from '../data/ids.js';
import { createRegionGrid, listCells } from '../data/regionCells.js';
import { setRegionBounds } from '../data/regions.js';
import { listSteps } from '../data/runSteps.js';
import { setMonthlyCap } from '../data/userBudget.js';
import { openTestDb, resetData } from '../data/testDb.js';
import { dismissalFeedback } from '../data/views.js';
import type { Bounds } from '../lib/geo.js';
import { signStep } from '../runner/webhooks.js';
import { testRunner } from '../test/testRunner.js';
import { CSRF_HEADER } from './csrf.js';

// Contract tests for every route: status codes, response shapes, 401 without a session, 404
// across users, 403 without a CSRF token, and input validation. Runs go through the fake
// Apify, so nothing here spends money.

const PASSWORD = 'correct horse battery';
const SECRET = 'webhook-secret-0123456789';
const SFAX: Bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };
const TUNIS: Bounds = { south: 36.7, west: 10.0, north: 36.9, east: 10.3 };
const SOUSSE: Bounds = { south: 35.7, west: 10.5, north: 35.9, east: 10.7 };
const NO_SUCH = '00000000-0000-4000-8000-000000000000';

interface Who {
  id: UserId;
  token: string;
  csrf: string;
}

let db: Db;
let app: FastifyInstance;
let auth: AuthService;
let world: ReturnType<typeof testRunner>;
let alice: Who;
let bob: Who;
let seededRun: string;
const extraApps: FastifyInstance[] = [];

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

async function mkApp(opts: { paid?: boolean; secret?: string | null } = {}) {
  auth = new AuthService(db, { ...DEFAULT_POLICY });
  const a = await buildApp({
    db,
    auth,
    runner: world.runner,
    paidRunsEnabled: opts.paid ?? true,
    webhookSecret: opts.secret === undefined ? SECRET : opts.secret,
  });
  extraApps.push(a);
  return a;
}

async function signIn(email: string): Promise<Who> {
  const id = await auth.createUserAsAdmin(email, PASSWORD);
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
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
  return { id, token, csrf };
}

/** A request as `who` (or with no session), with the CSRF token unless told otherwise. */
function call(
  who: Who | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  o: { csrf?: string | null; headers?: Record<string, string>; on?: FastifyInstance } = {},
) {
  const token = o.csrf === undefined ? who?.csrf : o.csrf;
  return (o.on ?? app).inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
    headers: { ...(token ? { [CSRF_HEADER]: token } : {}), ...o.headers },
  });
}

/** Advances a run until it is over and nothing is out with the (fake) Apify. */
async function drive(user: UserId, runId: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const r = await world.runner.advance(user, runId);
    if (r.status !== 'running' && r.status !== 'pending' && r.inFlight === 0) return;
  }
  throw new Error('run did not settle');
}

async function seedRun(user: UserId, regionId = 'sfax'): Promise<string> {
  const run = await world.runner.startRun(user, {
    regionId,
    sectorIds: ['textile'],
    budgetCapUsd: 10,
  });
  await drive(user, run.id);
  return run.id;
}

async function rowCounts() {
  const out: Record<string, number> = {};
  for (const t of [
    'runs',
    'run_steps',
    'cost_ledger',
    'run_companies',
    'cell_claims',
    'region_cells',
    'companies',
    'apify_events',
  ]) {
    out[t] = (await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM ${t}`)).rows[0]!.n;
  }
  return out;
}

beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  world = testRunner(db, { polls: 1 });
  app = await mkApp();
  await setRegionBounds(db, 'sfax', SFAX);
  await setRegionBounds(db, 'tunis', TUNIS);
  await setRegionBounds(db, 'sousse', SOUSSE);
  await createRegionGrid(db, 'sfax', SFAX, 1, 2);
  alice = await signIn('alice@example.com');
  bob = await signIn('bob@example.com');
  seededRun = await seedRun(alice.id);
});
afterEach(async () => {
  for (const a of extraApps.splice(0)) await a.close();
});

// ---------------------------------------------------------------------------------------
// Every route has a case here: 401 when signed out, 403 without a CSRF token, 404 for
// another user's data. A new route that is not added fails "covers every route".

interface Ids {
  run: string;
  lead: string;
  card: string;
  company: string;
  region: string;
  cell: string;
}
interface RouteCase {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  pattern: string;
  url: (ids: Ids) => string;
  body?: unknown;
}
const CASES: RouteCase[] = [
  { method: 'GET', pattern: '/api/auth/me', url: () => '/api/auth/me' },
  { method: 'GET', pattern: '/api/auth/csrf', url: () => '/api/auth/csrf' },
  {
    method: 'POST',
    pattern: '/api/runs/preview',
    url: () => '/api/runs/preview',
    body: { regionId: 'sfax' },
  },
  {
    method: 'POST',
    pattern: '/api/runs',
    url: () => '/api/runs',
    body: { regionId: 'tunis', budgetCapUsd: 5, confirm: true },
  },
  { method: 'GET', pattern: '/api/runs', url: () => '/api/runs' },
  { method: 'GET', pattern: '/api/runs/:id', url: (i) => `/api/runs/${i.run}` },
  { method: 'POST', pattern: '/api/runs/:id/stop', url: (i) => `/api/runs/${i.run}/stop` },
  { method: 'GET', pattern: '/api/runs/:id/costs', url: (i) => `/api/runs/${i.run}/costs` },
  { method: 'GET', pattern: '/api/regions', url: () => '/api/regions' },
  { method: 'GET', pattern: '/api/regions/suggestion', url: () => '/api/regions/suggestion' },
  { method: 'GET', pattern: '/api/regions/geometry', url: () => '/api/regions/geometry' },
  { method: 'GET', pattern: '/api/coverage', url: () => '/api/coverage' },
  {
    method: 'GET',
    pattern: '/api/regions/:regionId/cells',
    url: (i) => `/api/regions/${i.region}/cells`,
  },
  {
    method: 'GET',
    pattern: '/api/regions/:regionId/cells/:cellId',
    url: (i) => `/api/regions/${i.region}/cells/${i.cell}`,
  },
  { method: 'GET', pattern: '/api/leads', url: () => '/api/leads' },
  { method: 'GET', pattern: '/api/leads/:id', url: (i) => `/api/leads/${i.lead}` },
  {
    method: 'PATCH',
    pattern: '/api/leads/:id/stage',
    url: (i) => `/api/leads/${i.lead}/stage`,
    body: { stage: 'confirmed' },
  },
  {
    method: 'POST',
    pattern: '/api/leads/:id/objection',
    url: (i) => `/api/leads/${i.lead}/objection`,
    body: { reason: 'asked not to be contacted' },
  },
  { method: 'GET', pattern: '/api/crm/:pipeline', url: () => '/api/crm/companies' },
  {
    method: 'GET',
    pattern: '/api/crm/:pipeline/cards',
    url: () => '/api/crm/companies/cards',
  },
  {
    method: 'GET',
    pattern: '/api/crm/:pipeline/facets',
    url: () => '/api/crm/companies/facets',
  },
  {
    method: 'GET',
    pattern: '/api/crm/cards/by-company/:companyId',
    url: (i) => `/api/crm/cards/by-company/${i.company}`,
  },
  {
    method: 'PATCH',
    pattern: '/api/crm/companies/:companyId/notes',
    url: (i) => `/api/crm/companies/${i.company}/notes`,
    body: { notes: 'Call after Ramadan' },
  },
  {
    method: 'POST',
    pattern: '/api/crm/cards/:id/move',
    url: (i) => `/api/crm/cards/${i.card}/move`,
    body: { stage: 'investigating' },
  },
  {
    method: 'POST',
    pattern: '/api/crm/cards/:id/decision-maker',
    url: (i) => `/api/crm/cards/${i.card}/decision-maker`,
    body: { fullName: 'Amel Ben Salah', email: 'amel@example.tn' },
  },
  {
    method: 'POST',
    pattern: '/api/crm/cards/:id/remove',
    url: (i) => `/api/crm/cards/${i.card}/remove`,
  },
  {
    method: 'POST',
    pattern: '/api/crm/cards/:id/restore',
    url: (i) => `/api/crm/cards/${i.card}/restore`,
  },
  { method: 'GET', pattern: '/api/costs', url: () => '/api/costs' },
  { method: 'GET', pattern: '/api/costs/budget', url: () => '/api/costs/budget' },
  {
    method: 'PUT',
    pattern: '/api/costs/budget',
    url: () => '/api/costs/budget',
    body: { capUsd: 20 },
  },
  { method: 'GET', pattern: '/api/apify/log', url: () => '/api/apify/log' },
];
/** Public routes: sign-in (tested in auth.test.ts) and the signed webhook (below). */
const PUBLIC = [
  'GET /api/auth/config',
  'POST /api/auth/login',
  'POST /api/auth/signup',
  'POST /api/auth/logout',
  'POST /api/webhooks/apify',
];

async function ids(): Promise<Ids> {
  const leads = (await call(alice, 'GET', '/api/leads')).json().items;
  const cell = (await listCells(db, 'sfax', { leafOnly: true }))[0]!;
  const first = (await call(alice, 'GET', '/api/crm/companies')).json().stages[0].cards[0];
  return {
    run: seededRun,
    lead: leads[0].id,
    card: first.id,
    company: first.company.id,
    region: 'sfax',
    cell: cell.id,
  };
}

describe('every route', () => {
  it('covers every registered route with a case', () => {
    const registered = app.routeTable
      .filter((r) => !r.public)
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(registered).toEqual(CASES.map((c) => `${c.method} ${c.pattern}`).sort());
    expect(
      app.routeTable
        .filter((r) => r.public)
        .map((r) => `${r.method} ${r.url}`)
        .sort(),
    ).toEqual([...PUBLIC].sort());
  });

  it('returns 401 without a session, whatever the method', async () => {
    const i = await ids();
    for (const c of CASES) {
      const res = await call(null, c.method, c.url(i), c.body);
      expect(res.statusCode, `${c.method} ${c.pattern}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  it('returns 401 for a forged or expired session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs',
      cookies: { [SESSION_COOKIE]: 'forged' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects every state-changing request without a valid CSRF token', async () => {
    const i = await ids();
    const writes = CASES.filter((c) => c.method !== 'GET');
    expect(writes.length).toBeGreaterThanOrEqual(6);
    const before = await rowCounts();
    for (const c of writes) {
      const missing = await call(alice, c.method, c.url(i), c.body, { csrf: null });
      expect(missing.statusCode, `${c.method} ${c.pattern} (missing)`).toBe(403);
      expect(missing.json()).toEqual({ error: 'csrf_token_invalid' });
      const wrong = await call(alice, c.method, c.url(i), c.body, { csrf: 'x'.repeat(43) });
      expect(wrong.statusCode, `${c.method} ${c.pattern} (wrong)`).toBe(403);
      // Bob's valid token is not valid for Alice's session.
      const bobs = await call(alice, c.method, c.url(i), c.body, { csrf: bob.csrf });
      expect(bobs.statusCode, `${c.method} ${c.pattern} (other user)`).toBe(403);
    }
    // Nothing was written by any of them.
    expect(await rowCounts()).toEqual(before);
  });

  it('does not ask for a CSRF token on reads', async () => {
    const i = await ids();
    for (const c of CASES.filter((x) => x.method === 'GET')) {
      const res = await call(alice, 'GET', c.url(i), undefined, { csrf: null });
      expect(res.statusCode, `GET ${c.pattern}`).toBe(200);
    }
  });

  it('answers 404 to another user for every route that takes an ID', async () => {
    const i = await ids();
    const withId = CASES.filter((c) => c.pattern.includes(':'));
    for (const c of withId) {
      if (c.pattern.startsWith('/api/regions/')) continue; // geometry is shared; see regions
      if (c.pattern.startsWith('/api/crm/:pipeline')) continue; // a board name, not an ID
      const res = await call(bob, c.method, c.url(i), c.body);
      expect(res.statusCode, `${c.method} ${c.pattern}`).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found', message: 'not_found' });
    }
  });
});

describe('csrf', () => {
  it('issues a token only to a signed-in session, and it is stable for that session', async () => {
    const a = await call(alice, 'GET', '/api/auth/csrf');
    expect(a.statusCode).toBe(200);
    expect(a.json().token).toBe(alice.csrf);
    expect(a.headers['cache-control']).toBe('no-store');
    expect(alice.csrf).not.toBe(bob.csrf);
    expect((await call(null, 'GET', '/api/auth/csrf')).statusCode).toBe(401);
  });

  it('rejects a cross-origin request even with a valid token, accepts the same origin', async () => {
    const bad = await call(
      alice,
      'PUT',
      '/api/costs/budget',
      { capUsd: 5 },
      {
        headers: { origin: 'https://evil.example' },
      },
    );
    expect(bad.statusCode).toBe(403);
    expect(bad.json()).toEqual({ error: 'csrf_origin_mismatch' });
    const same = await call(
      alice,
      'PUT',
      '/api/costs/budget',
      { capUsd: 5 },
      {
        headers: { origin: 'http://localhost' },
      },
    );
    expect(same.statusCode).toBe(200);
  });

  it('checks the origin on sign-in too, where there is no session to carry a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('keeps tokens out of the logs', async () => {
    const { LOG_REDACT } = await import('../app.js');
    expect(LOG_REDACT).toContain('req.headers["x-csrf-token"]');
  });
});

// ---------------------------------------------------------------------------------------

describe('POST /api/runs/preview', () => {
  it('estimates volume and cost for a region', async () => {
    const res = await call(alice, 'POST', '/api/runs/preview', {
      regionId: 'tunis',
      sectorIds: ['textile'],
      budgetCapUsd: 10,
    });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({
      regionId: 'tunis',
      mode: 'normal',
      volume: { kind: 'estimate' },
      cost: { kind: 'estimate' },
      limits: { budgetCapUsd: 10, maxActiveRuns: 2, activeRuns: 0, monthCapUsd: null },
      blockers: [],
    });
    expect(p.queriesTotal).toBeGreaterThan(0);
    expect(p.queries.length).toBeGreaterThan(0);
    expect(p.cells).toHaveLength(2);
    expect(p.cost.totalUsd).toBeGreaterThan(0);
    expect(p.cost.upperBoundUsd).toBeGreaterThanOrEqual(p.cost.discoverUsd);
    expect(p.cost.totalUsd).toBeCloseTo(
      p.cost.discoverUsd + p.cost.findPeopleUsd + p.cost.enrichUsd,
      5,
    );
    expect(p.assumptions.length).toBeGreaterThan(3);
  });

  it('never spends, starts, claims or writes anything', async () => {
    const before = await rowCounts();
    const starts = world.apify.starts.length;
    for (const regionId of ['tunis', 'sfax']) {
      const res = await call(alice, 'POST', '/api/runs/preview', { regionId, budgetCapUsd: 5 });
      expect(res.statusCode).toBe(200);
    }
    expect(await rowCounts()).toEqual(before);
    expect(world.apify.starts).toHaveLength(starts);
    // Not even the region's cells are built by a preview (tunis has none yet).
    expect(await listCells(db, 'tunis', { leafOnly: true })).toEqual([]);
  });

  it('reports what would block a start', async () => {
    await setMonthlyCap(db, alice.id, new Date(), 5);
    const over = (
      await call(alice, 'POST', '/api/runs/preview', { regionId: 'tunis', budgetCapUsd: 10 })
    ).json();
    expect(over.blockers.map((b: { code: string }) => b.code)).toEqual([
      'cap_exceeds_month_remaining',
    ]);
    const tiny = (
      await call(alice, 'POST', '/api/runs/preview', { regionId: 'tunis', budgetCapUsd: 0.1 })
    ).json();
    expect(tiny.blockers.map((b: { code: string }) => b.code)).toContain('budget_below_minimum');
    const none = (await call(alice, 'POST', '/api/runs/preview', { regionId: 'gabes' })).json();
    expect(none.blockers.map((b: { code: string }) => b.code)).toContain('no_bounds');
  });

  describe('the search plan', () => {
    const preview = async (over: Record<string, unknown>) =>
      (await call(alice, 'POST', '/api/runs/preview', { regionId: 'tunis', ...over })).json();

    it('lists the actual queries per cell and the sector list', async () => {
      const p = await preview({ sectorIds: ['textile'] });
      // 2 cells x 2 textile wordings.
      expect(p.queriesTotal).toBe(4);
      expect(p.queries).toHaveLength(4);
      expect(p.queries[0]).toEqual({
        wording: expect.any(String),
        sectorId: 'textile',
        cellKey: expect.any(String),
      });
      expect(new Set(p.queries.map((q: { cellKey: string }) => q.cellKey))).toEqual(
        new Set(p.cells.map((c: { cellKey: string }) => c.cellKey)),
      );
      expect(p.sectors).toHaveLength(15);
      expect(p.sectors.find((s: { id: string }) => s.id === 'import-export')).toMatchObject({
        name: 'Import and export',
        wordings: ['import export', "société d'import", 'exportateur', 'commerce international'],
      });
    });

    it('shows the first 50 queries and the total', async () => {
      const p = await preview({});
      expect(p.queriesTotal).toBeGreaterThan(50);
      expect(p.queries).toHaveLength(50);
    });

    it('adds typed-in wordings, cleaned and deduplicated, with no sector', async () => {
      const base = await preview({ sectorIds: ['textile'] });
      const p = await preview({
        sectorIds: ['textile'],
        customWordings: [
          '  Entrepôt   frigorifique ',
          'entrepot frigorifique',
          'ENTREPÔT FRIGORIFIQUE',
          'usine textile',
        ],
      });
      // One new wording ('usine textile' already belongs to textile): 2 cells x 1 more.
      expect(p.queriesTotal).toBe(base.queriesTotal + 2);
      const custom = p.queries.filter((q: { sectorId: unknown }) => q.sectorId === null);
      expect(custom.map((q: { wording: string }) => q.wording)).toEqual([
        'Entrepôt frigorifique',
        'Entrepôt frigorifique',
      ]);
    });

    it('searches only typed-in wordings when no sector is picked, and refuses an empty plan', async () => {
      const p = await preview({ sectorIds: [], customWordings: ['entrepôt frigorifique'] });
      expect(p.queriesTotal).toBe(2);
      expect(p.queries.every((q: { sectorId: unknown }) => q.sectorId === null)).toBe(true);
      const res = await call(alice, 'POST', '/api/runs/preview', {
        regionId: 'tunis',
        sectorIds: [],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.some((i: { path: string }) => i.path === 'sectorIds')).toBe(true);
    });

    it('restricts the run to chosen cells', async () => {
      const all = await preview({ sectorIds: ['textile'] });
      const one = all.cells[0].cellKey;
      const p = await preview({ sectorIds: ['textile'], cellKeys: [one] });
      expect(p.cells.map((c: { cellKey: string }) => c.cellKey)).toEqual([one]);
      expect(p.queriesTotal).toBe(2);
      const none = await preview({ sectorIds: ['textile'], cellKeys: ['r9c9'] });
      expect(none.blockers.map((b: { code: string }) => b.code)).toContain('no_free_cells');
    });

    it('limits and validates wordings', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `mot ${i}`);
      expect(
        (
          await call(alice, 'POST', '/api/runs/preview', {
            regionId: 'tunis',
            customWordings: twenty,
          })
        ).statusCode,
      ).toBe(200);
      for (const customWordings of [[...twenty, 'mot 21'], ['x'.repeat(81)], ['   '], ['']]) {
        const res = await call(alice, 'POST', '/api/runs/preview', {
          regionId: 'tunis',
          customWordings,
        });
        expect(res.statusCode, JSON.stringify(customWordings)).toBe(400);
      }
      expect(
        (
          await call(alice, 'POST', '/api/runs/preview', {
            regionId: 'tunis',
            customWordings: ['x'.repeat(80)],
          })
        ).statusCode,
      ).toBe(200);
    });
  });

  it('validates its input', async () => {
    for (const [payload, field] of [
      [{}, 'regionId'],
      [{ regionId: 'sfax', sectorIds: ['nonsense'] }, 'sectorIds.0'],
      [{ regionId: 'sfax', budgetCapUsd: -1 }, 'budgetCapUsd'],
      [{ regionId: 'sfax', budgetCapUsd: 'ten' }, 'budgetCapUsd'],
      [{ regionId: 'sfax', mode: 'turbo' }, 'mode'],
      [{ regionId: 'sfax', surprise: true }, ''],
    ] as const) {
      const res = await call(alice, 'POST', '/api/runs/preview', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request' });
      expect(res.json().issues.some((i: { path: string }) => i.path === field)).toBe(true);
    }
    expect(
      (await call(alice, 'POST', '/api/runs/preview', { regionId: 'atlantis' })).statusCode,
    ).toBe(404);
  });
});

describe('POST /api/runs', () => {
  const start = (who: Who, over: Record<string, unknown> = {}) =>
    call(who, 'POST', '/api/runs', {
      regionId: 'tunis',
      sectorIds: ['textile'],
      budgetCapUsd: 5,
      confirm: true,
      ...over,
    });

  it('starts a run, scoped to the signed-in user, without spending anything yet', async () => {
    const res = await start(alice);
    expect(res.statusCode).toBe(201);
    const run = res.json();
    expect(run).toMatchObject({
      region: 'tunis',
      status: 'running',
      budgetCapUsd: 5,
      spentUsd: 0,
      mode: 'normal',
      sectors: ['textile'],
      funnel: { discovered: 0, leads: 0 },
    });
    expect((await listLiveClaims(db, alice.id)).length).toBe(2);
    expect((await call(alice, 'GET', `/api/runs/${run.id}`)).statusCode).toBe(200);
    expect((await call(bob, 'GET', `/api/runs/${run.id}`)).statusCode).toBe(404);
  });

  it('refuses a start without confirm, without a cap, or with anything unexpected', async () => {
    const before = await rowCounts();
    const bad: [Record<string, unknown>, string][] = [
      [{ confirm: undefined }, 'confirm'],
      [{ confirm: false }, 'confirm'],
      [{ confirm: 'true' }, 'confirm'],
      [{ budgetCapUsd: undefined }, 'budgetCapUsd'],
      [{ budgetCapUsd: 0 }, 'budgetCapUsd'],
      [{ budgetCapUsd: -5 }, 'budgetCapUsd'],
      [{ budgetCapUsd: 1e9 }, 'budgetCapUsd'],
      [{ budgetCapUsd: null }, 'budgetCapUsd'],
    ];
    for (const [over, field] of bad) {
      const res = await start(alice, over);
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(res.json().issues.some((i: { path: string }) => i.path === field)).toBe(true);
    }
    expect((await start(alice, { surprise: 1 })).statusCode).toBe(400);
    expect(await rowCounts()).toEqual(before);
  });

  it('is closed while paid runs are switched off, after validating the request', async () => {
    const off = await mkApp({ paid: false });
    const refused = await call(
      alice,
      'POST',
      '/api/runs',
      {
        regionId: 'tunis',
        budgetCapUsd: 5,
        confirm: true,
      },
      { on: off },
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('paid_runs_disabled');
    const invalid = await call(alice, 'POST', '/api/runs', { regionId: 'tunis' }, { on: off });
    expect(invalid.statusCode).toBe(400);
    // Previews and reads still work.
    expect(
      (await call(alice, 'POST', '/api/runs/preview', { regionId: 'tunis' }, { on: off }))
        .statusCode,
    ).toBe(200);
  });

  it('refuses a run whose cap could break the monthly cap, and a spent month', async () => {
    await setMonthlyCap(db, alice.id, new Date(), 5);
    const over = await start(alice, { budgetCapUsd: 10 });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('cap_exceeds_month_remaining');
    expect((await start(alice, { budgetCapUsd: 1 })).statusCode).toBe(201);
    // The seeded run already spent some; a cap at or below that is a spent month.
    await setMonthlyCap(db, alice.id, new Date(), 0.001);
    const spent = await start(alice, { regionId: 'sousse', budgetCapUsd: 0.5 });
    expect(spent.statusCode).toBe(409);
    expect(spent.json().error).toBe('monthly_cap_reached');
    // Another user's cap is not Alice's.
    expect((await start(bob, { budgetCapUsd: 5 })).statusCode).toBe(201);
  });

  it('allows two concurrent runs per user and refuses a third', async () => {
    expect((await start(alice, { regionId: 'tunis' })).statusCode).toBe(201);
    expect((await start(alice, { regionId: 'sousse' })).statusCode).toBe(201);
    const third = await start(alice, { regionId: 'sfax' });
    expect(third.statusCode).toBe(409);
    expect(third.json().error).toBe('concurrent_run_limit');
    // Bob has his own allowance.
    expect((await start(bob, { regionId: 'tunis' })).statusCode).toBe(201);
  });

  it('refuses a region with no map bounds, and an unknown region', async () => {
    const none = await start(alice, { regionId: 'gabes' });
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toBe('no_bounds');
    expect((await start(alice, { regionId: 'atlantis' })).statusCode).toBe(404);
  });
});

describe('POST /api/runs with a search plan', () => {
  const start = (over: Record<string, unknown>) =>
    call(alice, 'POST', '/api/runs', {
      regionId: 'tunis',
      budgetCapUsd: 5,
      confirm: true,
      ...over,
    });

  it('stores the plan and plans the typed-in wordings', async () => {
    const res = await start({
      sectorIds: ['textile'],
      customWordings: ['Entrepôt frigorifique', 'entrepot frigorifique'],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      sectors: ['textile'],
      customOnly: false,
      customWordings: ['Entrepôt frigorifique'],
      cellKeys: [],
    });
    const steps = (await listSteps(db, alice.id, res.json().id)).filter(
      (s) => s.stage === 'discover',
    );
    // 2 cells x (2 textile wordings + 1 typed in).
    expect(steps).toHaveLength(6);
    expect(steps.filter((s) => s.stepKey.endsWith('|entrepot frigorifique'))).toHaveLength(2);
  });

  it('searches only the typed-in wordings when no sector is picked', async () => {
    const res = await start({ sectorIds: [], customWordings: ['entrepôt frigorifique'] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sectors: [], customOnly: true });
    const steps = (await listSteps(db, alice.id, res.json().id)).filter(
      (s) => s.stage === 'discover',
    );
    expect(steps).toHaveLength(2);
  });

  it('claims only the chosen cells', async () => {
    const preview = (
      await call(alice, 'POST', '/api/runs/preview', { regionId: 'tunis', sectorIds: ['textile'] })
    ).json();
    const wanted = preview.cells[1].cellKey;
    const res = await start({ sectorIds: ['textile'], cellKeys: [wanted] });
    expect(res.statusCode).toBe(201);
    expect(res.json().cellKeys).toEqual([wanted]);
    expect((await listLiveClaims(db, alice.id)).length).toBe(1);
    const steps = (await listSteps(db, alice.id, res.json().id)).filter(
      (s) => s.stage === 'discover',
    );
    expect(steps.every((s) => s.stepKey.startsWith(`${wanted}|`))).toBe(true);
  });

  it('still needs a cap and a confirm, and an empty plan is refused', async () => {
    expect((await start({ confirm: false })).statusCode).toBe(400);
    expect((await start({ budgetCapUsd: undefined })).statusCode).toBe(400);
    expect((await start({ sectorIds: [] })).statusCode).toBe(400);
  });
});

describe('GET /api/coverage', () => {
  const coverage = async (who: Who) => (await call(who, 'GET', '/api/coverage')).json();
  const entry = (c: { entries: CoverageEntry[] }, r: string, s: string | null): CoverageEntry =>
    c.entries.find((e) => e.regionId === r && e.sectorId === s)!;

  it('reports queries, new places, leads, spend, cost per lead and a state per region and sector', async () => {
    const c = await coverage(alice);
    expect(c.regions).toHaveLength(24);
    expect(c.sectors).toHaveLength(15);
    const textile = entry(c, 'sfax', 'textile');
    // 2 cells x 2 textile wordings.
    expect(textile).toMatchObject({ queriesRun: 4, leads: 4, newPlaces: 4 });
    expect(['yielding', 'saturated']).toContain(textile.state);
    expect(textile.spendUsd).toBeGreaterThan(0);
    expect(textile.costPerLeadUsd).toBeCloseTo(textile.spendUsd / 4, 5);
    // The searches just ran, so the last-run date is now.
    expect(Date.now() - new Date(textile.lastRunAt!).getTime()).toBeLessThan(10 * 60_000);
    expect(entry(c, 'sfax', 'wholesale')).toMatchObject({
      queriesRun: 0,
      leads: 0,
      spendUsd: 0,
      costPerLeadUsd: null,
      lastRunAt: null,
      state: 'not_searched',
    });
    expect(entry(c, 'tunis', 'textile')).toMatchObject({ state: 'not_searched' });
  });

  it('adds up to the ledger: the sector spends of a region are its total spend', async () => {
    const c = await coverage(alice);
    const total = c.entries
      .filter((e: { regionId: string }) => e.regionId === 'sfax')
      .reduce((n: number, e: { spendUsd: number }) => n + e.spendUsd, 0);
    const sfax = (await call(alice, 'GET', '/api/regions'))
      .json()
      .items.find((r: { regionId: string }) => r.regionId === 'sfax');
    expect(total).toBeCloseTo(sfax.spendUsd, 5);
  });

  it('marks a sector saturated once every wording is exhausted in every cell', async () => {
    const cells = await listCells(db, 'sfax', { leafOnly: true });
    for (const cell of cells) {
      for (const w of ['usine textile', 'confection']) {
        await db.query(
          'INSERT INTO exhausted_queries (user_id, region_cell_id, normalized_query) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [alice.id, cell.id, w],
        );
      }
    }
    expect(entry(await coverage(alice), 'sfax', 'textile').state).toBe('saturated');
  });

  it('moves a saturated sector to maintenance once its last search is older than the interval', async () => {
    const cells = await listCells(db, 'sfax', { leafOnly: true });
    for (const cell of cells) {
      for (const w of ['usine textile', 'confection']) {
        await db.query(
          'INSERT INTO exhausted_queries (user_id, region_cell_id, normalized_query) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [alice.id, cell.id, w],
        );
      }
    }
    const saturated = entry(await coverage(alice), 'sfax', 'textile');
    expect(saturated.state).toBe('saturated');
    await db.query(
      "UPDATE search_queries SET created_at = now() - interval '45 days' WHERE user_id = $1",
      [alice.id],
    );
    const due = entry(await coverage(alice), 'sfax', 'textile');
    expect(due.state).toBe('maintenance');
    expect(new Date(due.lastRunAt!).getTime()).toBeLessThan(Date.now() - 40 * 86_400_000);
  });

  it("shows another user none of Alice's history", async () => {
    const c = await coverage(bob);
    expect(
      c.entries.every(
        (e: { state: string; spendUsd: number; queriesRun: number }) =>
          e.state === 'not_searched' && e.spendUsd === 0 && e.queriesRun === 0,
      ),
    ).toBe(true);
    expect(entry(c, 'sfax', 'textile')).toMatchObject({ leads: 0 });
  });
});

describe('GET /api/regions/geometry', () => {
  it('gives each region its bounds and outline, shared by all users', async () => {
    const g = (await call(alice, 'GET', '/api/regions/geometry')).json();
    expect(g.items).toHaveLength(24);
    const sfax = g.items.find((r: { regionId: string }) => r.regionId === 'sfax');
    expect(sfax.bounds).toMatchObject({ south: 34.6, north: 34.9 });
    // No stored outline in the test database: the bounds are drawn as a rectangle.
    expect(sfax).toMatchObject({ outlineSource: 'bounds', outline: { type: 'Polygon' } });
    const gabes = g.items.find((r: { regionId: string }) => r.regionId === 'gabes');
    expect(gabes).toMatchObject({ bounds: null, outline: null, outlineSource: null });
    expect((await call(bob, 'GET', '/api/regions/geometry')).json()).toEqual(g);
  });
});

describe('GET /api/runs', () => {
  it('lists the user’s runs with status, region, funnel, spend and cap, paginated', async () => {
    await call(alice, 'POST', '/api/runs', {
      regionId: 'tunis',
      budgetCapUsd: 5,
      confirm: true,
    });
    await call(alice, 'POST', '/api/runs', {
      regionId: 'sousse',
      budgetCapUsd: 5,
      confirm: true,
    });
    const first = (await call(alice, 'GET', '/api/runs?limit=2')).json();
    expect(first).toMatchObject({ total: 3, limit: 2, offset: 0, nextOffset: 2 });
    expect(first.items).toHaveLength(2);
    const last = (await call(alice, 'GET', '/api/runs?limit=2&offset=2')).json();
    expect(last.items).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
    const seeded = last.items[0];
    expect(seeded).toMatchObject({
      id: seededRun,
      region: 'sfax',
      status: 'finished',
      budgetCapUsd: 10,
    });
    expect(seeded.spentUsd).toBeGreaterThan(0);
    expect(seeded.funnel).toMatchObject({ discovered: 4, scored: 4, leads: 4, skipped: 0 });
    expect(
      (await call(alice, 'GET', '/api/runs?status=finished'))
        .json()
        .items.map((r: { id: string }) => r.id),
    ).toEqual([seededRun]);
  });

  it('shows another user none of it', async () => {
    expect((await call(bob, 'GET', '/api/runs')).json()).toMatchObject({ items: [], total: 0 });
  });

  it('validates pagination and filters', async () => {
    for (const url of [
      '/api/runs?limit=0',
      '/api/runs?limit=101',
      '/api/runs?offset=-1',
      '/api/runs?limit=abc',
      '/api/runs?status=exploded',
    ]) {
      expect((await call(alice, 'GET', url)).statusCode, url).toBe(400);
    }
  });
});

describe('GET /api/runs/:id', () => {
  it('returns the run with its leads and every lead’s evidence', async () => {
    const res = await call(alice, 'GET', `/api/runs/${seededRun}`);
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run).toMatchObject({ id: seededRun, status: 'finished', leadsTotal: 4 });
    expect(run.steps.map((s: { stage: string }) => s.stage)).toEqual([
      'discover',
      'find_people',
      'enrich',
    ]);
    expect(run.leads).toHaveLength(4);
    for (const lead of run.leads) {
      expect(lead.crmStage).toBe('system_suggested');
      expect(lead.score.total).toBe(
        lead.score.companyFit + lead.score.contactFit + lead.score.reachability,
      );
      expect(lead.company.evidence.length).toBeGreaterThan(0);
      expect(lead.contact.evidence.length).toBeGreaterThan(0);
      for (const e of [...lead.company.evidence, ...lead.contact.evidence]) {
        expect(e).toMatchObject({
          field: expect.any(String),
          sourceUrl: expect.stringMatching(/^https:\/\//),
          kind: expect.stringMatching(/^(fact|estimate)$/),
        });
        expect(new Date(e.fetchedAt).getTime()).not.toBeNaN();
      }
      // A found email is an estimate citing where it came from, never a fact.
      const email = lead.contact.evidence.find((e: { field: string }) => e.field === 'email');
      expect(email.kind).toBe('estimate');
    }
  });

  it('is a 404 for another user’s run, an unknown run and a malformed ID', async () => {
    expect((await call(bob, 'GET', `/api/runs/${seededRun}`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/runs/${NO_SUCH}`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', "/api/runs/1' OR '1'='1")).statusCode).toBe(404);
  });
});

describe('POST /api/runs/:id/stop', () => {
  it('stops an active run and frees its cells', async () => {
    const started = (
      await call(alice, 'POST', '/api/runs', { regionId: 'tunis', budgetCapUsd: 5, confirm: true })
    ).json();
    expect((await listLiveClaims(db, alice.id)).length).toBe(2);
    const res = await call(alice, 'POST', `/api/runs/${started.id}/stop`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: started.id, status: 'cancelled' });
    expect(await listLiveClaims(db, alice.id)).toEqual([]);
    // Stopping again, or stopping a finished run, is a conflict, not a second stop.
    expect((await call(alice, 'POST', `/api/runs/${started.id}/stop`)).statusCode).toBe(409);
    const done = await call(alice, 'POST', `/api/runs/${seededRun}/stop`);
    expect(done.statusCode).toBe(409);
    expect(done.json().error).toBe('run_not_active');
    // A stopped run starts no more steps.
    await world.runner.advance(alice.id, started.id);
    expect(
      await listSteps(db, alice.id, started.id).then((s) => s.filter((x) => x.apifyRunId)),
    ).toEqual([]);
  });

  it('collects a step already out with Apify when the run is stopped', async () => {
    const started = (
      await call(alice, 'POST', '/api/runs', { regionId: 'tunis', budgetCapUsd: 5, confirm: true })
    ).json();
    await world.runner.advance(alice.id, started.id); // four Apify runs out
    expect((await listLiveClaims(db, alice.id)).length).toBe(2);
    expect((await call(alice, 'POST', `/api/runs/${started.id}/stop`)).statusCode).toBe(200);
    // Claims stay while Apify runs are out, then are released once they are collected.
    for (let i = 0; i < 5; i++) await world.runner.advance(alice.id, started.id);
    expect(await listLiveClaims(db, alice.id)).toEqual([]);
    // Every step that went out is collected; the ones never started stay pending for good.
    const steps = await listSteps(db, alice.id, started.id);
    expect(steps.filter((s) => s.apifyRunId).every((s) => s.processedAt !== null)).toBe(true);
    expect(steps.some((s) => s.status === 'started')).toBe(false);
    const costs = (await call(alice, 'GET', `/api/runs/${started.id}/costs`)).json();
    expect(costs.unsettledEstimateUsd).toBe(0);
  });

  it('cannot stop another user’s run', async () => {
    const started = (
      await call(alice, 'POST', '/api/runs', { regionId: 'tunis', budgetCapUsd: 5, confirm: true })
    ).json();
    expect((await call(bob, 'POST', `/api/runs/${started.id}/stop`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/runs/${started.id}`)).json().status).toBe('running');
  });
});

describe('regions and coverage', () => {
  it('lists every region with coverage, yield, cost per lead and saturation status', async () => {
    const page = (await call(alice, 'GET', '/api/regions')).json();
    expect(page.total).toBe(24);
    expect(page.items).toHaveLength(24);
    const sfax = page.items.find((r: { regionId: string }) => r.regionId === 'sfax');
    expect(sfax).toMatchObject({
      status: 'active',
      hasBounds: true,
      cellsTotal: 2,
      cellsSearched: 2,
      cellsExhausted: 0,
      coverage: 1,
      leads: 4,
      runs: 1,
    });
    expect(sfax.spendUsd).toBeGreaterThan(0);
    expect(sfax.costPerLeadUsd).toBeCloseTo(sfax.spendUsd / 4, 6);
    expect(sfax.newPlacesPerQuery).toBeGreaterThan(0);
    expect(sfax.qualifiedShare).not.toBeNull();
    const tunis = page.items.find((r: { regionId: string }) => r.regionId === 'tunis');
    expect(tunis).toMatchObject({ leads: 0, costPerLeadUsd: null, coverage: null });
    const small = (await call(alice, 'GET', '/api/regions?limit=5&offset=20')).json();
    expect(small).toMatchObject({ total: 24, nextOffset: null });
    expect(small.items).toHaveLength(4);
  });

  it('shows another user no coverage, spend or leads', async () => {
    const sfax = (await call(bob, 'GET', '/api/regions'))
      .json()
      .items.find((r: { regionId: string }) => r.regionId === 'sfax');
    expect(sfax).toMatchObject({
      leads: 0,
      spendUsd: 0,
      runs: 0,
      cellsSearched: 0,
      queriesRun: 0,
      qualifiedShare: null,
    });
  });

  it('explains the suggested next region', async () => {
    const s = (await call(alice, 'GET', '/api/regions/suggestion')).json();
    expect(s).toMatchObject({ regionId: 'sfax', mode: 'normal' });
    expect(s.reason).toMatch(/best yield/);
    expect(s.ranking.length).toBeGreaterThan(0);
    const mine = (await call(bob, 'GET', '/api/regions/suggestion')).json();
    expect(mine.regionId).toBeNull();
    expect(mine.reason).toBe(
      'Pick a region to start. We recommend a small one like Sfax for a first test.',
    );
  });

  it('gives per-cell detail', async () => {
    const cells = (await call(alice, 'GET', '/api/regions/sfax/cells')).json();
    expect(cells).toMatchObject({ total: 2, nextOffset: null });
    const cell = cells.items[0];
    expect(cell).toMatchObject({ queriesRun: 2, claimedByRunId: null, exhaustedAt: null });
    expect(cell.bounds.north).toBeGreaterThan(cell.bounds.south);
    const detail = (
      await call(alice, 'GET', `/api/regions/sfax/cells/${cell.regionCellId}`)
    ).json();
    expect(detail.queries).toHaveLength(2);
    expect(detail.queries[0]).toMatchObject({
      provider: expect.any(String),
      resultsReturned: expect.any(Number),
      costUsd: expect.any(Number),
    });
    expect(detail.exhaustedWordings).toEqual(expect.arrayContaining([expect.any(String)]));
    // Cell geometry is shared; Bob sees it with none of Alice's history.
    const theirs = (await call(bob, 'GET', `/api/regions/sfax/cells/${cell.regionCellId}`)).json();
    expect(theirs).toMatchObject({ queriesRun: 0, spendUsd: 0, leads: 0, queries: [] });
  });

  it('404s an unknown region, a cell of another region and a malformed cell ID', async () => {
    const cell = (await listCells(db, 'sfax', { leafOnly: true }))[0]!;
    expect((await call(alice, 'GET', '/api/regions/atlantis/cells')).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/regions/tunis/cells/${cell.id}`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', '/api/regions/sfax/cells/nope')).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/regions/sfax/cells/${NO_SUCH}`)).statusCode).toBe(404);
  });
});

describe('leads and the CRM', () => {
  it('lists leads with filters, best score first, paginated', async () => {
    const all = (await call(alice, 'GET', '/api/leads')).json();
    expect(all).toMatchObject({ total: 4, nextOffset: null });
    const scores = all.items.map((l: { score: { total: number } }) => l.score.total);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await call(alice, 'GET', '/api/leads?limit=3')).json()).toMatchObject({
      total: 4,
      nextOffset: 3,
    });
    expect((await call(alice, 'GET', '/api/leads?limit=3&offset=3')).json().items).toHaveLength(1);

    const count = async (qs: string) => (await call(alice, 'GET', `/api/leads?${qs}`)).json().total;
    expect(await count('stage=system_suggested')).toBe(4);
    expect(await count('stage=confirmed,contacted')).toBe(0);
    expect(await count('stage=confirmed&stage=system_suggested')).toBe(4);
    expect(await count(`runId=${seededRun}`)).toBe(4);
    expect(await count(`runId=${NO_SUCH}`)).toBe(0);
    expect(await count('regionId=sfax')).toBe(4);
    expect(await count('regionId=tunis')).toBe(0);
    expect(await count('minScore=100')).toBe(0);
    expect(await count(`minScore=${scores[0]}`)).toBeGreaterThan(0);
    expect(await count('q=fixture')).toBe(4);
    expect(await count('q=nothing-like-this')).toBe(0);
    expect(await count('q=%25')).toBe(0); // a literal percent sign, not a wildcard
  });

  it('validates filters', async () => {
    for (const qs of ['stage=sold', 'minScore=101', 'runId=nope', 'limit=0', 'q=']) {
      expect((await call(alice, 'GET', `/api/leads?${qs}`)).statusCode, qs).toBe(400);
    }
  });

  it('shows another user none of the leads', async () => {
    expect((await call(bob, 'GET', '/api/leads')).json()).toMatchObject({ items: [], total: 0 });
    const lead = (await ids()).lead;
    expect((await call(bob, 'GET', `/api/leads/${lead}`)).statusCode).toBe(404);
  });

  it('returns one lead with its evidence', async () => {
    const lead = (await call(alice, 'GET', `/api/leads/${(await ids()).lead}`)).json();
    expect(lead.company.evidence.length).toBeGreaterThan(0);
    expect(lead.runId).toBe(seededRun);
    expect((await call(alice, 'GET', '/api/leads/not-a-uuid')).statusCode).toBe(404);
  });

  it('moves a lead through every stage', async () => {
    const id = (await ids()).lead;
    for (const stage of [
      'confirmed',
      'contacted',
      'response',
      'won',
      'lost',
      'dismissed',
      'system_suggested',
    ]) {
      const res = await call(alice, 'PATCH', `/api/leads/${id}/stage`, { stage });
      expect(res.statusCode, stage).toBe(200);
      expect(res.json()).toMatchObject({ id, crmStage: stage });
    }
  });

  it('validates a move, and another user cannot make one', async () => {
    const id = (await ids()).lead;
    for (const payload of [{}, { stage: 'sold' }, { stage: 'confirmed', surprise: 1 }]) {
      expect((await call(alice, 'PATCH', `/api/leads/${id}/stage`, payload)).statusCode).toBe(400);
    }
    expect((await call(bob, 'PATCH', `/api/leads/${id}/stage`, { stage: 'won' })).statusCode).toBe(
      404,
    );
    expect((await call(alice, 'GET', `/api/leads/${id}`)).json().crmStage).toBe('system_suggested');
  });

  it('keeps a dismissed lead dismissed when a later run finds it again', async () => {
    const lead = (await call(alice, 'GET', `/api/leads/${(await ids()).lead}`)).json();
    await call(alice, 'PATCH', `/api/leads/${lead.id}/stage`, { stage: 'dismissed' });
    const again = await upsertLead(db, alice.id, {
      runId: seededRun,
      companyId: lead.company.id,
      contactId: lead.contact.id,
      score: { companyFit: 50, contactFit: 30, reachability: 20 },
    });
    expect(again).toMatchObject({ created: false, lead: { id: lead.id, stage: 'dismissed' } });
    const suggested = (await call(alice, 'GET', '/api/leads?stage=system_suggested')).json();
    expect(suggested.items.map((l: { id: string }) => l.id)).not.toContain(lead.id);
    expect(suggested.total).toBe(3);
  });

  it('feeds dismissals back into the scores of later leads', async () => {
    const baseline = (await call(alice, 'GET', '/api/leads')).json().items[0];
    expect(baseline.contact.roleClass).toBe('logistics');
    await call(alice, 'PATCH', `/api/leads/${baseline.id}/stage`, { stage: 'dismissed' });
    const feedback = await dismissalFeedback(db, alice.id);
    expect(feedback.bySector).toEqual({ textile: 1 });
    expect(feedback.byRoleClass).toEqual({ logistics: 1 });

    // The next run's fake Apify returns one more place per cell, so there is a new company.
    world = testRunner(db, { polls: 1, placesPerCell: () => 3 });
    app = await mkApp();
    const later = await seedRun(alice.id, 'tunis');
    const lead = (await call(alice, 'GET', `/api/leads?runId=${later}`)).json().items[0];
    // Same kind of company and person, so the only difference is the dismissal: -2 and -3.
    expect(lead.score.companyFit).toBe(baseline.score.companyFit - 2);
    expect(lead.score.contactFit).toBe(baseline.score.contactFit - 3);
    expect(lead.score.reachability).toBe(baseline.score.reachability);
    // Bob dismissed nothing, so his scores are untouched.
    expect(await dismissalFeedback(db, bob.id)).toEqual({ bySector: {}, byRoleClass: {} });
  });

  it('records an objection: suppresses the person and moves the lead to Opted out', async () => {
    const lead = (await call(alice, 'GET', `/api/leads/${(await ids()).lead}`)).json();
    const res = await call(alice, 'POST', `/api/leads/${lead.id}/objection`, {
      reason: '  asked by phone not to be contacted  ',
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.lead).toMatchObject({ id: lead.id, crmStage: 'opted_out' });
    expect(out.suppressed.sort()).toEqual(['email', 'linkedin']);

    const rows = await db.query<{ kind: string; reason: string; recorded_by: string }>(
      'SELECT kind, reason, recorded_by FROM suppression_list ORDER BY kind',
    );
    expect(rows.rows).toEqual([
      { kind: 'email', reason: 'asked by phone not to be contacted', recorded_by: alice.id },
      { kind: 'linkedin', reason: 'asked by phone not to be contacted', recorded_by: alice.id },
    ]);
    // The person can no longer be stored, by anyone.
    await expect(
      upsertContact(db, bob.id, {
        companyId: lead.company.id,
        fullName: { value: 'X', sourceUrl: 'https://x.test', fetchedAt: new Date(), kind: 'fact' },
        linkedinPublicId: {
          value: lead.contact.linkedinPublicId,
          sourceUrl: 'https://x.test',
          fetchedAt: new Date(),
          kind: 'fact',
        },
      }),
    ).rejects.toBeInstanceOf(Error);
    // Other leads are untouched.
    expect((await call(alice, 'GET', '/api/leads?stage=system_suggested')).json().total).toBe(3);
  });

  it('treats Opted out as final, and the stage endpoint opts out through the same path', async () => {
    const id = (await ids()).lead;
    const needsReason = await call(alice, 'PATCH', `/api/leads/${id}/stage`, {
      stage: 'opted_out',
    });
    expect(needsReason.statusCode).toBe(400);
    expect(needsReason.json().issues[0].path).toBe('reason');
    const done = await call(alice, 'PATCH', `/api/leads/${id}/stage`, {
      stage: 'opted_out',
      reason: 'objected',
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().crmStage).toBe('opted_out');
    expect((await db.query('SELECT 1 FROM suppression_list')).rowCount).toBe(2);
    const back = await call(alice, 'PATCH', `/api/leads/${id}/stage`, { stage: 'confirmed' });
    expect(back.statusCode).toBe(409);
    expect(back.json().error).toBe('opted_out_is_final');
    expect((await call(alice, 'GET', `/api/leads/${id}`)).json().crmStage).toBe('opted_out');
  });

  it('validates an objection, and another user cannot record one', async () => {
    const id = (await ids()).lead;
    for (const payload of [
      {},
      { reason: '' },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
      { reason: 'ok', extra: 1 },
    ]) {
      expect((await call(alice, 'POST', `/api/leads/${id}/objection`, payload)).statusCode).toBe(
        400,
      );
    }
    expect(
      (await call(bob, 'POST', `/api/leads/${id}/objection`, { reason: 'trying' })).statusCode,
    ).toBe(404);
    expect((await db.query('SELECT 1 FROM suppression_list')).rowCount).toBe(0);
    expect((await call(alice, 'GET', `/api/leads/${id}`)).json().crmStage).toBe('system_suggested');
  });
});

describe('costs', () => {
  it('groups the ledger by month, run, region and provider', async () => {
    const run = (await call(alice, 'GET', '/api/runs')).json().items[0];
    const by = async (g: string) => (await call(alice, 'GET', `/api/costs?groupBy=${g}`)).json();
    const month = await by('month');
    expect(month.items).toHaveLength(1);
    expect(month.items[0].key).toMatch(/^\d{4}-\d{2}$/);
    expect(month.items[0].totalUsd).toBeCloseTo(run.spentUsd, 6);
    expect(month.items[0].actualUsd).toBeCloseTo(run.spentUsd, 6);
    expect(month.items[0].openEstimateUsd).toBe(0);
    expect((await by('run')).items.map((r: { key: string }) => r.key)).toEqual([seededRun]);
    expect((await by('region')).items.map((r: { key: string }) => r.key)).toEqual(['sfax']);
    expect((await by('provider')).items.map((r: { key: string }) => r.key)).toEqual(['apify']);
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(
      (await call(alice, 'GET', `/api/costs?groupBy=run&month=${thisMonth}`)).json().total,
    ).toBe(1);
    expect((await call(alice, 'GET', '/api/costs?groupBy=run&month=2020-01')).json().total).toBe(0);
  });

  it('validates and isolates', async () => {
    for (const qs of ['groupBy=colour', 'month=2026-13', 'month=October', 'limit=0']) {
      expect((await call(alice, 'GET', `/api/costs?${qs}`)).statusCode, qs).toBe(400);
    }
    expect((await call(bob, 'GET', '/api/costs?groupBy=run')).json()).toMatchObject({ items: [] });
  });

  it('reads and sets the monthly cap, with what remains', async () => {
    const before = (await call(alice, 'GET', '/api/costs/budget')).json();
    expect(before).toMatchObject({ capUsd: null, remainingUsd: null });
    expect(before.spentUsd).toBeGreaterThan(0);
    expect(before.month).toMatch(/^\d{4}-\d{2}-01$/);

    const set = await call(alice, 'PUT', '/api/costs/budget', { capUsd: 25 });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ capUsd: 25 });
    expect(set.json().remainingUsd).toBeCloseTo(25 - before.spentUsd, 6);
    expect((await call(alice, 'GET', '/api/costs/budget')).json().capUsd).toBe(25);
    // Lowering it below what is spent leaves nothing remaining, never a negative number.
    expect(
      (await call(alice, 'PUT', '/api/costs/budget', { capUsd: 0.0001 })).json().remainingUsd,
    ).toBe(0);
    // Another month.
    const other = await call(alice, 'PUT', '/api/costs/budget', { capUsd: 7, month: '2030-01' });
    expect(other.json()).toMatchObject({ month: '2030-01-01', capUsd: 7, spentUsd: 0 });
    // Bob's budget is his own.
    expect((await call(bob, 'GET', '/api/costs/budget')).json().capUsd).toBeNull();
  });

  it('validates the cap', async () => {
    for (const payload of [
      {},
      { capUsd: 0 },
      { capUsd: -1 },
      { capUsd: '20' },
      { capUsd: null },
      { capUsd: 5, month: 'soon' },
      { capUsd: 5, extra: 1 },
    ]) {
      expect((await call(alice, 'PUT', '/api/costs/budget', payload)).statusCode).toBe(400);
    }
  });

  it('shows one run’s ledger with estimate vs actual, to its owner only', async () => {
    const res = await call(alice, 'GET', `/api/runs/${seededRun}/costs?limit=5`);
    expect(res.statusCode).toBe(200);
    const costs = res.json();
    const run = (await call(alice, 'GET', `/api/runs/${seededRun}`)).json();
    expect(costs).toMatchObject({ runId: seededRun, unsettledEstimateUsd: 0 });
    expect(costs.ledgerUsd).toBeCloseTo(run.spentUsd, 6);
    expect(costs.entries.items).toHaveLength(5);
    expect(costs.entries.total).toBeGreaterThan(5);
    expect(costs.entries.nextOffset).toBe(5);
    expect(costs.entries.items[0]).toMatchObject({ provider: 'apify', kind: expect.any(String) });
    expect((await call(bob, 'GET', `/api/runs/${seededRun}/costs`)).statusCode).toBe(404);
  });
});

describe('GET /api/apify/log', () => {
  it('shows finished runs with each Apify run’s state history', async () => {
    const log = (await call(alice, 'GET', '/api/apify/log')).json();
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].run.id).toBe(seededRun);
    expect(log.runs[0].steps.length).toBeGreaterThan(0);
    for (const step of log.runs[0].steps) {
      expect(step.history.map((e: { state: string }) => e.state)).toEqual([
        'started',
        'running',
        'finished',
      ]);
      expect(step.latestState).toBe('finished');
    }
    expect(log.attention).toEqual([]);
    expect(log.recent.total).toBe(
      log.runs[0].steps.reduce((n: number, s: { history: unknown[] }) => n + s.history.length, 0),
    );
    expect(log.recent.items[0].occurredAt >= log.recent.items.at(-1).occurredAt).toBe(true);
    expect((await call(alice, 'GET', '/api/apify/log?limit=2')).json().recent.items).toHaveLength(
      2,
    );
  });

  it('flags runs that are restarting or resumed, active runs first', async () => {
    world = testRunner(db, { polls: 3 });
    app = await mkApp();
    alice = await signInAgain('alice@example.com');
    const started = (
      await call(alice, 'POST', '/api/runs', { regionId: 'tunis', budgetCapUsd: 5, confirm: true })
    ).json();
    await world.runner.advance(alice.id, started.id);
    let log = (await call(alice, 'GET', '/api/apify/log')).json();
    expect(log.runs[0].run.id).toBe(started.id); // the active run before the finished one
    expect(
      log.runs[0].steps.every((s: { latestState: string }) => s.latestState === 'started'),
    ).toBe(true);
    expect(log.attention).toEqual([]);

    const apifyRun = [...world.apify.runs.keys()][0]!;
    world.apify.migrate(apifyRun);
    await world.runner.advance(alice.id, started.id);
    log = (await call(alice, 'GET', '/api/apify/log')).json();
    expect(log.attention).toHaveLength(1);
    expect(log.attention[0]).toMatchObject({ apifyRunId: apifyRun, latestState: 'restarting' });

    // The backend restarts: it re-attaches to the Apify runs it left behind.
    await world.runner.recover();
    log = (await call(alice, 'GET', '/api/apify/log')).json();
    expect(log.attention.map((s: { latestState: string }) => s.latestState)).toContain('resumed');
    const states = log.runs[0].steps.flatMap((s: { history: { state: string }[] }) =>
      s.history.map((e) => e.state),
    );
    expect(states).toEqual(expect.arrayContaining(['started', 'running', 'restarting', 'resumed']));
  });

  it('shows another user nothing', async () => {
    const log = (await call(bob, 'GET', '/api/apify/log')).json();
    expect(log).toMatchObject({ runs: [], attention: [], recent: { items: [], total: 0 } });
  });

  async function signInAgain(email: string): Promise<Who> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    });
    const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const csrf = (
      await app.inject({
        method: 'GET',
        url: '/api/auth/csrf',
        cookies: { [SESSION_COOKIE]: token },
      })
    ).json().token as string;
    return { id: alice.id, token, csrf };
  }
});

describe('POST /api/webhooks/apify', () => {
  const body = (userId: string, stepId: string, secret = SECRET, extra: object = {}) => ({
    userId,
    stepId,
    signature: signStep(secret, userId, stepId),
    eventType: 'ACTOR.RUN.SUCCEEDED',
    resource: { id: 'fakeRun1' },
    ...extra,
  });
  const hook = (payload: unknown, on?: FastifyInstance) =>
    call(null, 'POST', '/api/webhooks/apify', payload, on ? { on } : {});

  /** A started run whose Apify runs have finished, so a webhook has something to collect. */
  async function outWithApify() {
    world = testRunner(db, { polls: 0 });
    app = await mkApp();
    const run = await world.runner.startRun(alice.id, {
      regionId: 'tunis',
      sectorIds: ['textile'],
      budgetCapUsd: 10,
    });
    await world.runner.advance(alice.id, run.id);
    const steps = (await listSteps(db, alice.id, run.id)).filter((s) => s.status === 'started');
    expect(steps.length).toBeGreaterThan(0);
    return { run, step: steps[0]! };
  }

  it('rejects a bad signature before touching the runner', async () => {
    const { run, step } = await outWithApify();
    const before = await rowCounts();
    for (const payload of [
      body(alice.id, step.id, 'a-different-secret'),
      { ...body(alice.id, step.id), signature: 'f'.repeat(64) },
      { ...body(alice.id, step.id), stepId: step.id.replace(/.$/, (c) => (c === '0' ? '1' : '0')) },
      { userId: alice.id, stepId: step.id },
      { ...body(alice.id, step.id), signature: 12345 },
      'just text',
      [],
      null,
    ]) {
      const res = await hook(payload);
      expect([400, 401, 415], JSON.stringify(payload)).toContain(res.statusCode);
    }
    expect((await hook(body(alice.id, step.id, 'a-different-secret'))).json()).toEqual({
      error: 'invalid_signature',
    });
    expect(await rowCounts()).toEqual(before);
    const after = await listSteps(db, alice.id, run.id);
    expect(after.find((s) => s.id === step.id)!.status).toBe('started');
  });

  it('is closed when no secret is configured', async () => {
    const closed = await mkApp({ secret: null });
    const { step } = await outWithApify();
    const res = await hook(body(alice.id, step.id), closed);
    expect(res.statusCode).toBe(503);
  });

  it('accepts a signed event without a session or CSRF token and hands it to the runner', async () => {
    const { run, step } = await outWithApify();
    const res = await hook(body(alice.id, step.id));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true, known: true });
    const steps = await listSteps(db, alice.id, run.id);
    expect(steps.find((s) => s.id === step.id)).toMatchObject({ status: 'finished' });
    expect(steps.find((s) => s.id === step.id)!.processedAt).not.toBeNull();
  });

  it('ignores a repeated event: nothing is applied or paid for twice', async () => {
    const { run, step } = await outWithApify();
    await hook(body(alice.id, step.id));
    const after1 = await rowCounts();
    const ledger = (await call(alice, 'GET', `/api/runs/${run.id}/costs`)).json().ledgerUsd;
    for (let i = 0; i < 3; i++) expect((await hook(body(alice.id, step.id))).statusCode).toBe(202);
    expect((await rowCounts()).cost_ledger).toBe(after1.cost_ledger);
    expect((await rowCounts()).companies).toBe(after1.companies);
    expect((await call(alice, 'GET', `/api/runs/${run.id}/costs`)).json().ledgerUsd).toBe(ledger);
    expect(
      (
        await db.query('SELECT 1 FROM apify_events WHERE run_step_id = $1 AND state = $2', [
          step.id,
          'finished',
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('accepts and ignores an unknown step, a malformed ID, or a step of another user', async () => {
    const { run, step } = await outWithApify();
    const before = await rowCounts();
    for (const [user, stepId] of <[string, string][]>[
      [alice.id, NO_SUCH],
      [alice.id, 'not-a-uuid'],
      ['not-a-uuid', step.id],
      [bob.id, step.id], // signed for Bob, but the step is Alice's
    ]) {
      const res = await hook(body(user, stepId));
      expect(res.statusCode, `${user} ${stepId}`).toBe(202);
      expect(res.json()).toEqual({ accepted: true, known: false });
    }
    expect(await rowCounts()).toEqual(before);
    expect((await listSteps(db, alice.id, run.id)).find((s) => s.id === step.id)!.status).toBe(
      'started',
    );
  });
});

describe('crm boards', () => {
  const totalOf = (s: { total: number }) => s.total;
  const post = (who: Who, url: string, payload?: unknown) => call(who, 'POST', url, payload ?? {});

  it('puts every company with a lead on the Companies board, in Found', async () => {
    const board = (await call(alice, 'GET', '/api/crm/companies')).json();
    expect(board.stages.map((s: { key: string }) => s.key)).toEqual([
      'found',
      'investigating',
      'decision_maker_identified',
      'noise',
    ]);
    expect(board.stages.at(-1)).toMatchObject({ name: 'Noise', collapsedByDefault: true });
    const found = board.stages[0];
    expect(found.total).toBeGreaterThan(0);
    expect(found.cards.length).toBe(found.total);
    for (const c of found.cards)
      expect(c).toMatchObject({ pipeline: 'companies', stage: 'found', person: null });
    expect((await call(alice, 'GET', '/api/crm/people')).json().stages.map(totalOf)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
    expect((await call(bob, 'GET', '/api/crm/companies')).json().stages.map(totalOf)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('counts what each folder holds, filters by found-in and run, and keeps users apart', async () => {
    const facets = (await call(alice, 'GET', '/api/crm/companies/facets')).json();
    expect(facets.total).toBeGreaterThan(0);
    expect(facets.stages.map((x: { key: string }) => x.key)).toEqual([
      'found',
      'investigating',
      'decision_maker_identified',
    ]);
    expect((await call(bob, 'GET', '/api/crm/companies/facets')).json().total).toBe(0);
    expect((await call(alice, 'GET', '/api/crm/companies/facets?foundDays=0')).statusCode).toBe(
      400,
    );
    expect((await call(alice, 'GET', '/api/crm/companies/cards?runId=nope')).statusCode).toBe(400);
    const recent = (await call(alice, 'GET', '/api/crm/companies/cards?foundDays=7')).json();
    expect(recent.cards[0]).toHaveProperty('foundAt');
    expect(recent.cards[0]).toHaveProperty('runId');
    const lively = await call(alice, 'GET', '/api/crm/companies/cards?excludeNoise=true');
    expect(lively.json().cards.every((c: { stage: string }) => c.stage !== 'noise')).toBe(true);
  });

  it('needs a decision-maker to reach Decision-maker identified, then creates the person card', async () => {
    const id = (await ids()).card;
    const refused = await post(alice, `/api/crm/cards/${id}/move`, {
      stage: 'decision_maker_identified',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('decision_maker_required');

    for (const bad of [
      {},
      { fullName: 'Amel' },
      { fullName: 'Amel', email: 'nope' },
      { email: 'a@b.tn' },
    ]) {
      expect((await post(alice, `/api/crm/cards/${id}/decision-maker`, bad)).statusCode).toBe(400);
    }
    const ok = await post(alice, `/api/crm/cards/${id}/decision-maker`, {
      fullName: 'Amel Ben Salah',
      title: 'Responsable logistique',
      email: 'amel@example.tn',
      phone: '',
      linkedinUrl: '',
    });
    expect(ok.statusCode).toBe(201);
    const { company, person } = ok.json();
    expect(company).toMatchObject({ id, stage: 'decision_maker_identified' });
    expect(person).toMatchObject({
      pipeline: 'people',
      stage: 'new',
      company: { id: company.company.id },
      person: { fullName: 'Amel Ben Salah', email: 'amel@example.tn' },
    });
    const people = (await call(alice, 'GET', '/api/crm/people')).json();
    expect(people.stages[0].cards.map((c: { id: string }) => c.id)).toEqual([person.id]);
  });

  it('moves a person through the board; Opted out needs a reason, suppresses and is final', async () => {
    const id = (await ids()).card;
    const { person } = (
      await post(alice, `/api/crm/cards/${id}/decision-maker`, {
        fullName: 'Sami',
        email: 'sami@example.tn',
      })
    ).json();
    for (const stage of ['contacted', 'replied', 'won', 'lost', 'new']) {
      const res = await post(alice, `/api/crm/cards/${person.id}/move`, { stage });
      expect(res.json(), stage).toMatchObject({ id: person.id, stage });
    }
    expect(
      (await post(alice, `/api/crm/cards/${person.id}/move`, { stage: 'sold' })).statusCode,
    ).toBe(400);
    const noReason = await post(alice, `/api/crm/cards/${person.id}/move`, { stage: 'opted_out' });
    expect(noReason.statusCode).toBe(400);
    const done = await post(alice, `/api/crm/cards/${person.id}/move`, {
      stage: 'opted_out',
      reason: 'asked to stop',
    });
    expect(done.json()).toMatchObject({ stage: 'opted_out' });
    const back = await post(alice, `/api/crm/cards/${person.id}/move`, { stage: 'new' });
    expect(back.statusCode).toBe(409);
    expect(back.json().error).toBe('opted_out_is_final');
    expect((await post(alice, `/api/crm/cards/${person.id}/remove`)).statusCode).toBe(409);
    // The same person cannot be added again.
    const again = await post(alice, `/api/crm/cards/${id}/decision-maker`, {
      fullName: 'Sami',
      email: 'SAMI@example.tn',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('suppressed');
  });

  it("serves a company's page data: card, notes, history and decision-maker", async () => {
    const found = (await call(alice, 'GET', '/api/crm/companies')).json().stages[0].cards[0];
    const url = `/api/crm/cards/by-company/${found.company.id}`;
    const before = (await call(alice, 'GET', url)).json();
    expect(before).toMatchObject({ card: { id: found.id }, notes: '', person: null });
    expect(before.history.at(-1)).toMatchObject({ from: null });
    await post(alice, `/api/crm/cards/${found.id}/move`, { stage: 'investigating' });
    const moved = (await call(alice, 'GET', url)).json();
    expect(moved.card.stage).toBe('investigating');
    // Newest first: the move is on top of where the card started.
    expect(moved.history[0]).toMatchObject({ from: 'found', to: 'investigating' });
    expect(moved.history.length).toBe(before.history.length + 1);

    const saved = await call(alice, 'PATCH', `/api/crm/companies/${found.company.id}/notes`, {
      notes: 'Call after Ramadan.\nAsk for Amel.',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ notes: 'Call after Ramadan.\nAsk for Amel.' });
    expect((await call(alice, 'GET', url)).json().notes).toBe('Call after Ramadan.\nAsk for Amel.');
    // The note is the company's: the board card is unchanged and Bob cannot read or write it.
    expect((await call(bob, 'GET', url)).statusCode).toBe(404);
    expect(
      (await call(bob, 'PATCH', `/api/crm/companies/${found.company.id}/notes`, { notes: 'x' }))
        .statusCode,
    ).toBe(404);
    for (const bad of [{ notes: 'x'.repeat(5001) }, { notes: 5 }, {}, { notes: 'a', extra: 1 }]) {
      const res = await call(alice, 'PATCH', `/api/crm/companies/${found.company.id}/notes`, bad);
      expect(res.statusCode, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    await call(alice, 'PATCH', `/api/crm/companies/${found.company.id}/notes`, { notes: '' });
    expect((await call(alice, 'GET', url)).json().notes).toBe('');
    // Naming the decision-maker is part of the history, and the person comes back with it.
    await post(alice, `/api/crm/cards/${found.id}/decision-maker`, {
      fullName: 'Nour Gharbi',
      email: 'nour@example.tn',
    });
    const named = (await call(alice, 'GET', url)).json();
    expect(named.history[0]).toMatchObject({
      from: 'investigating',
      to: 'decision_maker_identified',
    });
    expect(named.person).toMatchObject({ pipeline: 'people', person: { fullName: 'Nour Gharbi' } });
    await post(alice, `/api/crm/cards/${found.id}/remove`);
    const removed = (await call(alice, 'GET', url)).json();
    expect(removed.card).toMatchObject({
      stage: 'noise',
      removedFrom: 'decision_maker_identified',
    });
    expect(removed.history[0]).toMatchObject({ to: 'noise' });
  });

  it('pages a column, filters and sorts on the server, and refuses bad queries', async () => {
    const first = (await call(alice, 'GET', '/api/crm/companies?limit=1')).json();
    expect(first.stages[0].cards).toHaveLength(1);
    const unfiltered = first.stages[0].total;
    const none = (await call(alice, 'GET', '/api/crm/companies?q=zzz-nothing')).json();
    expect(none.stages.map(totalOf)).toEqual([0, 0, 0, 0]);
    const page = (
      await call(alice, 'GET', '/api/crm/companies/cards?stage=found&sort=name&dir=desc')
    ).json();
    expect(page).toMatchObject({ total: unfiltered, nextCursor: null });
    const tiny = (await call(alice, 'GET', '/api/crm/companies/cards?stage=found&limit=1')).json();
    if (unfiltered > 1) {
      const next = (
        await call(
          alice,
          'GET',
          `/api/crm/companies/cards?stage=found&limit=1&cursor=${tiny.nextCursor}`,
        )
      ).json();
      expect(next.cards[0].id).not.toBe(tiny.cards[0].id);
    }
    for (const bad of [
      '/api/crm/nothing',
      '/api/crm/companies?sort=oldest',
      '/api/crm/companies?minScore=abc',
      '/api/crm/companies?limit=500',
      '/api/crm/companies/cards?stage=sold',
      '/api/crm/companies/cards?cursor=not-a-cursor',
    ]) {
      expect((await call(alice, 'GET', bad)).statusCode, bad).toBe(400);
    }
  });

  it('removes a card to Noise with days left, and restores it', async () => {
    const id = (await ids()).card;
    const removed = (await post(alice, `/api/crm/cards/${id}/remove`)).json();
    expect(removed).toMatchObject({ stage: 'noise', removedFrom: 'found' });
    const days = (Date.parse(removed.purgeAt) - Date.parse(removed.noiseAt)) / 86_400_000;
    expect(days).toBe(30);
    expect((await post(alice, `/api/crm/cards/${id}/restore`, { stage: 'noise' })).statusCode).toBe(
      400,
    );
    const restored = (await post(alice, `/api/crm/cards/${id}/restore`)).json();
    expect(restored).toMatchObject({ stage: 'found', noiseAt: null, purgeAt: null });
    expect((await post(alice, `/api/crm/cards/${id}/restore`)).statusCode).toBe(409);
  });
});
