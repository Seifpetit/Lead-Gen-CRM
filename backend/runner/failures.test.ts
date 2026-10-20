import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderHealth, listErrors } from '../data/appErrors.js';
import { listLedgerForRun } from '../data/costLedger.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRegionGrid } from '../data/regionCells.js';
import { getRunProblem } from '../data/runHealth.js';
import { listRunLog } from '../data/runLog.js';
import { listSteps } from '../data/runSteps.js';
import { getRun } from '../data/runs.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import type { Bounds } from '../lib/geo.js';
import { ErrorReporter } from './errorReporter.js';
import { HttpError } from '../httpClient.js';
import type { DiscoveryQuery } from '../providers/types.js';
import { fakeProviders } from '../test/fakeProviders.js';
import { Orchestrator } from './orchestrator.js';

// What the orchestrator does when a provider call fails: classify it, note it, tell the person
// in plain words, and never spend twice. Fake providers only; no network, no paid calls.

const SFAX: Bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };
const TOKEN = 'apify_api_TOPSECRET0123';
const url = (path = '/acts/x~y/runs') => `https://api.apify.com/v2${path}`;

let db: Db;
let user: UserId;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  user = await makeUser(db);
  await createRegionGrid(db, 'sfax', SFAX, 1, 2);
  await db.query("UPDATE regions SET outline = NULL WHERE id = 'sfax'");
  // No paid or external call may happen in these tests.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
});
afterEach(() => {
  fetchSpy.mockRestore();
});

/** The fake Apify, with a discovery call that fails as scripted before it works. */
function world(script: unknown[] = [], extra: { polls?: number } = {}) {
  const fake = fakeProviders({ polls: extra.polls ?? 1 });
  const queue = [...script];
  let calls = 0;
  const discovery = {
    name: fake.discovery.name,
    estimate: (q: DiscoveryQuery) => fake.discovery.estimate(q),
    collect: (ref: Parameters<typeof fake.discovery.collect>[0]) => fake.discovery.collect(ref),
    discoverCompanies: async (...args: Parameters<typeof fake.discovery.discoverCompanies>) => {
      calls += 1;
      if (queue.length > 0) {
        const next = queue.shift();
        if (next instanceof Error) throw next;
      }
      return fake.discovery.discoverCompanies(...args);
    },
  };
  const errors = new ErrorReporter(db, [TOKEN]);
  const sleeps: number[] = [];
  const orchestrator = new Orchestrator({
    db,
    discovery,
    people: fake.people,
    emails: fake.emails,
    errors,
    secrets: [TOKEN],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    config: { cellsPerRun: 2, providerRetryDelaysMs: [250] },
  });
  return { orchestrator, errors, sleeps, calls: () => calls, ...fake };
}

const start = (o: Orchestrator) =>
  o.startRun(user, { regionId: 'sfax', sectorIds: ['textile'], budgetCapUsd: 10 });

async function drive(o: Orchestrator, runId: string, max = 200) {
  for (let i = 0; i < max; i++) {
    const r = await o.advance(user, runId);
    if (r.status !== 'running' && r.status !== 'pending' && r.inFlight === 0) return r;
  }
  throw new Error('run did not settle');
}

const logOf = async (runId: string) => (await listRunLog(db, user, runId, { limit: 500 })).items;
const estimateSum = async (runId: string) =>
  (await listLedgerForRun(db, user, runId)).reduce((s, e) => s + e.amountUsd, 0);

describe('a provider that is out of credit', () => {
  it('ends the run with a plain reason, takes back the estimate and marks Apify down', async () => {
    const w = world([
      new HttpError(402, url(`/acts/x~y/runs?token=${TOKEN}`), 'Not enough credit'),
    ]);
    const run = await start(w.orchestrator);
    const end = await drive(w.orchestrator, run.id);
    expect(end.status).toBe('failed');
    expect((await getRun(db, user, run.id))!.status).toBe('failed');

    const row = await db.query('SELECT error FROM runs WHERE id = $1', [run.id]);
    expect(row.rows[0].error).toBe('Apify is out of credit: top up and start a new run');
    // The refused call cost nothing: the estimate was reversed, nothing is left as spend.
    expect(await estimateSum(run.id)).toBe(0);
    expect(w.apify.starts).toHaveLength(0);

    const health = await getProviderHealth(db, 'apify');
    expect(health).toMatchObject({
      state: 'down',
      kind: 'out_of_credit',
      reason: 'Apify is out of credit: top up and start a new run',
    });
  });

  it('writes the plain explanation first and the detail after, as one error line, masked', async () => {
    const w = world([new HttpError(402, url(`/acts/x~y/runs?token=${TOKEN}`), `bad ${TOKEN}`)]);
    const run = await start(w.orchestrator);
    await drive(w.orchestrator, run.id);
    const lines = await logOf(run.id);
    const failure = lines.find(
      (l) => l.level === 'error' && l.message.startsWith('Apify is out of credit'),
    )!;
    expect(failure.message).toMatch(
      /^Apify is out of credit: top up and start a new run\. Technical detail: HTTP 402 from https:\/\/api\.apify\.com\/v2\/acts\/x~y\/runs/,
    );
    expect(failure.technical).toBe(false);
    for (const l of lines) expect(l.message).not.toContain('TOPSECRET');
  });

  it('keeps a masked error with a count, and the same failure again counts up', async () => {
    const make = () =>
      world([new HttpError(402, url(`/acts/x~y/runs?token=${TOKEN}`), `credit gone ${TOKEN}`)]);
    for (let i = 0; i < 2; i++) {
      const w = make();
      const run = await start(w.orchestrator);
      await drive(w.orchestrator, run.id);
    }
    const errors = (await listErrors(db, user)).filter((e) => e.source === 'provider');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      provider: 'apify',
      step: 'discover',
      kind: 'out_of_credit',
      count: 2,
    });
    expect(errors[0]!.message).not.toContain('TOPSECRET');
    expect(errors[0]!.message).toContain('Apify is out of credit: top up and start a new run');
    expect(errors[0]!.stack ?? '').not.toContain('TOPSECRET');
    // The run that failed is noted as its own failure too.
    expect((await listErrors(db, user)).some((e) => e.kind === 'run_failed')).toBe(true);
  });

  it('makes no network call of its own', async () => {
    const w = world([new HttpError(402, url(), 'x')]);
    const run = await start(w.orchestrator);
    await drive(w.orchestrator, run.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('a provider hiccup', () => {
  it('searches again once after a 503 and carries on, with Apify ok afterwards', async () => {
    const w = world([new HttpError(503, url())]);
    const run = await start(w.orchestrator);
    const end = await drive(w.orchestrator, run.id);
    expect(end.status).toBe('finished');
    expect(w.sleeps).toEqual([250]);

    const lines = await logOf(run.id);
    expect(
      lines.some(
        (l) =>
          l.level === 'warn' &&
          l.message.includes('Apify had a problem on its side') &&
          l.message.includes('Searching again after a provider hiccup'),
      ),
    ).toBe(true);
    expect((await getProviderHealth(db, 'apify'))!.state).toBe('ok');
    expect(await getRunProblem(db, user, run.id)).toBeNull();
    // Each place is searched once: the retry did not double a paid search.
    expect(w.apify.starts.map((s) => s.label).sort()).toEqual(
      [...new Set(w.apify.starts.map((s) => s.label))].sort(),
    );
  });

  it('shows "trying again" while a 503 lasts, leaves the step for the next pass and recovers', async () => {
    const w = world([new HttpError(503, url()), new HttpError(503, url())]);
    const run = await start(w.orchestrator);
    await w.orchestrator.advance(user, run.id);
    const problem = await getRunProblem(db, user, run.id);
    expect(problem).toMatchObject({ kind: 'retrying', action: 'stop' });
    expect(problem!.message).toContain('Apify had a problem on its side');
    expect((await getRun(db, user, run.id))!.status).toBe('running');
    // Both failed calls were taken back, so nothing is owed and the step can start again.
    expect(await estimateSum(run.id)).toBe(0);
    expect((await listSteps(db, user, run.id)).every((s) => s.status === 'pending')).toBe(true);

    const end = await drive(w.orchestrator, run.id);
    expect(end.status).toBe('finished');
    expect(await getRunProblem(db, user, run.id)).toBeNull();
  });

  it('turns a long failure into a "down" state after three in a row', async () => {
    const w = world(Array.from({ length: 6 }, () => new HttpError(503, url())));
    const run = await start(w.orchestrator);
    await w.orchestrator.advance(user, run.id);
    expect((await getProviderHealth(db, 'apify'))!.state).toBe('degraded');
    await w.orchestrator.advance(user, run.id);
    expect((await getProviderHealth(db, 'apify'))!.state).toBe('down');
  });

  it('never repeats a call that may have started a paid run (a timeout)', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const w = world([timeout]);
    const run = await start(w.orchestrator);
    const end = await drive(w.orchestrator, run.id);
    // The run goes on without that step; its estimate stays as spend, as after a crash.
    expect(end.status).toBe('finished');
    expect(w.sleeps).toEqual([]);
    const failed = (await listSteps(db, user, run.id)).filter((s) => s.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toContain('estimate kept as spend');
    expect(await estimateSum(run.id)).toBeGreaterThan(0);
    expect(w.calls()).toBe(w.apify.startsFor(w.discovery.name).length + 1);
  });
});

describe('a provider that fails while a run waits for its result', () => {
  it('ends the run when the key is refused during polling', async () => {
    const w = world([], { polls: 3 });
    const run = await start(w.orchestrator);
    await w.orchestrator.advance(user, run.id);
    vi.spyOn(w.apify, 'collect').mockImplementation(() => {
      throw new HttpError(401, url('/actor-runs/r1'));
    });
    const end = await drive(w.orchestrator, run.id).catch(() => null);
    const after = await getRun(db, user, run.id);
    expect(after!.status).toBe('failed');
    expect(end === null || end.status === 'failed').toBe(true);
    const health = await getProviderHealth(db, 'apify');
    expect(health).toMatchObject({ state: 'down', kind: 'invalid_key' });
  });

  it('does not let one run that throws stop the poller from looking after the others', async () => {
    const w = world();
    const a = await start(w.orchestrator);
    const advance = vi.spyOn(w.orchestrator, 'advance');
    advance.mockRejectedValueOnce(new Error('something broke'));
    await expect(w.orchestrator.pollAll()).resolves.toBeGreaterThanOrEqual(1);
    expect(advance).toHaveBeenCalled();
    const errors = await listErrors(db, user);
    expect(errors.some((e) => e.kind === 'advance_failed' && e.runId === a.id)).toBe(true);
  });
});
