import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listApifyEventsForRun } from '../data/apifyEvents.js';
import { expireClaims, listLiveClaims } from '../data/cellClaims.js';
import { upsertCompany } from '../data/companies.js';
import { listLedgerForRun, runSpendByProvider } from '../data/costLedger.js';
import { purgeNoise, removeCard } from '../data/crmBoards.js';
import { listLeads } from '../data/crmLeads.js';
import { apifySteps, loadLeads, runSummaries } from '../data/views.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRegionGrid, listCells } from '../data/regionCells.js';
import { setRegionBounds } from '../data/regions.js';
import { getRun, RunLimitError } from '../data/runs.js';
import { listEvidence } from '../data/evidence.js';
import { listRunCompanies } from '../data/runCompanies.js';
import { listSteps } from '../data/runSteps.js';
import { listCellStats, listRegionStats } from '../data/saturation.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import { setMonthlyCap } from '../data/userBudget.js';
import type { Bounds } from '../lib/geo.js';
import { AnthropicClassifier } from '../providers/anthropicClassifier.js';
import { GOOGLE_MAPS_ACTOR } from '../providers/googleMapsApify.js';
import type { RequestOptions } from '../httpClient.js';
import type { HttpJson } from '../providers/http.js';
import { fakePlace, fakeProviders, type FakeApifyOptions } from '../test/fakeProviders.js';
import type { RunnerConfig } from './config.js';
import {
  Orchestrator,
  RunStartError,
  SimulatedCrash,
  type OrchestratorDeps,
} from './orchestrator.js';
import { reconcileRun } from './reconcile.js';
import { ALL_WORDINGS, NO_HISTORY_REASON, suggestNextRegion } from './scheduler.js';
import { signStep, verifyWebhook, webhookFor } from './webhooks.js';

// Orchestrator tests against a real Postgres and a fake Apify (test/fakeProviders.ts).
// No network, no paid calls.

const SFAX: Bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };
const TEXTILE = ['textile'];

let db: Db;
let user: UserId;
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
  // Two cells: small enough to saturate in a test.
  await createRegionGrid(db, 'sfax', SFAX, 1, 2);
});

function world(
  opts: FakeApifyOptions = {},
  config: Partial<RunnerConfig> = {},
  extra: Partial<OrchestratorDeps> = {},
) {
  const fake = fakeProviders(opts);
  const make = (more: Partial<OrchestratorDeps> = {}) =>
    new Orchestrator({
      db,
      discovery: fake.discovery,
      people: fake.people,
      emails: fake.emails,
      config: { cellsPerRun: 2, ...config },
      ...extra,
      ...more,
    });
  return { ...fake, orchestrator: make(), make };
}

/** Advances until the run is over and nothing is out with Apify. */
async function drive(o: Orchestrator, userId: UserId, runId: string, max = 1000) {
  for (let i = 0; i < max; i++) {
    const r = await o.advance(userId, runId);
    if (r.status !== 'running' && r.status !== 'pending' && r.inFlight === 0) return r;
  }
  throw new Error('run did not settle');
}

async function estimatesPerStep(runId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const e of await listLedgerForRun(db, user, runId)) {
    if (e.kind !== 'estimated' || e.correctsId || !e.runStepId) continue;
    counts.set(e.runStepId, (counts.get(e.runStepId) ?? 0) + 1);
  }
  return counts;
}

const duplicates = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

describe('orchestrator: a full run', () => {
  it('moves a region through every stage to scored leads, all from fake Apify runs', async () => {
    const w = world();
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    expect(run.status).toBe('running');
    expect(run.currentStage).toBe('discover');
    const end = await drive(w.orchestrator, user, run.id);
    expect(end.status).toBe('finished');

    // 2 cells x 2 textile wordings; the 2 places per cell are found by the first wording only.
    expect(w.apify.startsFor(GOOGLE_MAPS_ACTOR)).toHaveLength(4);
    const companies = await listRunCompanies(db, user, run.id);
    expect(companies.filter((c) => c.isNew)).toHaveLength(4);
    expect(companies.filter((c) => c.state === 'scored')).toHaveLength(4);
    const leads = await listLeads(db, user, { runId: run.id });
    expect(leads).toHaveLength(4);
    expect(leads.every((l) => l.contactId)).toBe(true);

    // Every step's estimate was replaced by an actual; nothing left unsettled.
    const rec = await reconcileRun(db, user, run.id);
    expect(rec.unsettledEstimateUsd).toBe(0);
    expect(rec.steps.every((s) => s.actualUsd !== null)).toBe(true);
    // Estimates are for 20 places; each query found 2 (or 0): actuals are much lower.
    expect(rec.actualUsd).toBeLessThan(rec.estimatedUsd);
    expect(rec.flagged.some((f) => f.note.startsWith('Under estimate'))).toBe(true);

    // State changes were logged per Apify run.
    const events = await listApifyEventsForRun(db, user, run.id);
    const states = new Set(events.map((e) => e.state));
    expect([...states].sort()).toEqual(['finished', 'running', 'started']);
    // Claims are released at the end.
    expect(await listLiveClaims(db, user)).toEqual([]);
  });

  it('passes a max cost to every Apify run, within the remaining budget', async () => {
    const w = world();
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    const runs = [...w.apify.runs.values()];
    expect(runs.every((r) => typeof r.options.maxTotalChargeUsd === 'number')).toBe(true);
    // Google Maps: never below the Actor's minimum of $0.50.
    const maps = runs.filter((r) => r.ref.actorId === GOOGLE_MAPS_ACTOR);
    expect(maps.every((r) => r.options.maxTotalChargeUsd === 0.5)).toBe(true);
  });

  it('logs Apify migrations as restarting and keeps polling', async () => {
    const w = world({ polls: 3 });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await w.orchestrator.advance(user, run.id); // starts discover steps
    w.apify.migrate('fakeRun1');
    await drive(w.orchestrator, user, run.id);
    const events = await listApifyEventsForRun(db, user, run.id);
    expect(events.filter((e) => e.state === 'restarting')).toHaveLength(1);
  });

  it('handles a signed webhook by advancing the run, and ignores a forged one', async () => {
    const secret = 'test-webhook-secret';
    const w = world({}, { webhook: { url: 'https://runner.example.test/apify', secret } });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await w.orchestrator.advance(user, run.id);
    const started = [...w.apify.runs.values()][0]!;
    const hook = started.options.webhooks![0]!;
    // What Apify would send: the template with eventType and resource filled in.
    const body = JSON.parse(
      hook
        .payloadTemplate!.replace('{{eventType}}', '"ACTOR.RUN.SUCCEEDED"')
        .replace('{{resource}}', '{"id":"fakeRun1"}'),
    );
    const payload = verifyWebhook(secret, body);
    expect(payload).toMatchObject({ userId: user, eventType: 'ACTOR.RUN.SUCCEEDED' });
    expect(verifyWebhook(secret, { ...body, stepId: 'someone-else' })).toBeNull();
    expect(verifyWebhook('wrong-secret', body)).toBeNull();
    expect(await w.orchestrator.onStepWebhook(user, payload!.stepId)).toMatchObject({
      status: 'running',
    });
    // The same webhook twice applies nothing twice.
    await w.orchestrator.onStepWebhook(user, payload!.stepId);
    await drive(w.orchestrator, user, run.id);
    expect([...(await estimatesPerStep(run.id)).values()].every((n) => n === 1)).toBe(true);
  });

  it('signs per step', () => {
    expect(signStep('s', 'u', 'a')).not.toBe(signStep('s', 'u', 'b'));
    expect(webhookFor({ url: 'https://x.test', secret: 's' }, 'u', 'a').eventTypes).toContain(
      'ACTOR.RUN.SUCCEEDED',
    );
  });
});

describe('orchestrator: crash safety', () => {
  async function baselineLabels(): Promise<string[]> {
    const labels: string[] = [];
    const w = world({}, {}, { checkpoint: (l) => void labels.push(l) });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    return [...new Set(labels)];
  }

  it('dies at every stage boundary and resumes without paying for anything twice', async () => {
    const labels = await baselineLabels();
    // Every boundary of every stage is covered.
    for (const l of [
      'run:created',
      'run:planned',
      'discover:estimated',
      'discover:called',
      'discover:started',
      'discover:applied',
      'stage:discover->qualify',
      'qualify:company',
      'find_people:planned',
      'find_people:called',
      'find_people:applied',
      'enrich:planned',
      'enrich:applied',
      'stage:verify->score',
      'score:company',
      'run:finished',
    ]) {
      expect(labels).toContain(l);
    }

    for (const label of labels) {
      await resetData(db);
      user = await makeUser(db);
      let armed = true;
      const w = world(
        {},
        {},
        {
          checkpoint: (l) => {
            if (armed && l === label) {
              armed = false;
              throw new SimulatedCrash(l);
            }
          },
        },
      );
      let runId: string | null = null;
      try {
        runId = (
          await w.orchestrator.startRun(user, {
            regionId: 'sfax',
            sectorIds: TEXTILE,
            budgetCapUsd: 10,
          })
        ).id;
        await drive(w.orchestrator, user, runId);
      } catch (err) {
        expect(err, label).toBeInstanceOf(SimulatedCrash);
      }
      expect(armed, `crash at ${label}`).toBe(false);

      // A new process: same database, same Apify account, no memory.
      const fresh = w.make({ checkpoint: () => {} });
      await fresh.recover();
      runId ??= (await db.query<{ id: string }>('SELECT id FROM runs WHERE user_id = $1', [user]))
        .rows[0]!.id;
      const end = await drive(fresh, user, runId);
      expect(end.status, label).toBe('finished');

      // Never started twice: each query, company and email batch went to Apify at most once.
      for (const actor of new Set(w.apify.starts.map((s) => s.actor))) {
        expect(duplicates(w.apify.startsFor(actor)), `${label} ${actor}`).toEqual([]);
      }
      // Never estimated twice, and every step settled or kept its one estimate.
      const counts = await estimatesPerStep(runId);
      expect(
        [...counts.values()].every((n) => n === 1),
        label,
      ).toBe(true);
      const steps = await listSteps(db, user, runId);
      expect(
        steps.every((s) => s.processedAt !== null),
        label,
      ).toBe(true);
      // Results are applied once: one company per place, one lead per contact.
      const companies = await db.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM companies WHERE user_id = $1',
        [user],
      );
      expect(companies.rows[0]!.n, label).toBeLessThanOrEqual(4);
      const rec = await reconcileRun(db, user, runId);
      expect(rec.ledgerUsd, label).toBeLessThanOrEqual(10);
    }
  }, 120_000);

  it('re-attaches to Apify runs that were out when the process died', async () => {
    const w = world({ polls: 2 });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await w.orchestrator.advance(user, run.id); // four runs started, then the process "dies"
    const fresh = w.make();
    const { runs, stepsResumed } = await fresh.recover();
    expect(runs).toBe(1);
    expect(stepsResumed).toBe(4);
    await drive(fresh, user, run.id);
    const events = await listApifyEventsForRun(db, user, run.id);
    expect(events.filter((e) => e.state === 'resumed')).toHaveLength(4);
    expect(duplicates(w.apify.startsFor(GOOGLE_MAPS_ACTOR))).toEqual([]);
  });
});

describe('orchestrator: money', () => {
  it('holds a step back while in-flight steps reserve the budget, then runs it', async () => {
    const w = world();
    // $0.70: room for one Google Maps run with its $0.50 max cost at a time, not two. The
    // others wait for it to settle instead of stopping the run.
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 0.7,
    });
    const end = await drive(w.orchestrator, user, run.id);
    expect(end.status).not.toBe('stopped_by_cap');
    expect(w.apify.startsFor(GOOGLE_MAPS_ACTOR).length).toBeGreaterThan(1);
    const after = (await getRun(db, user, run.id))!;
    expect(after.spentUsd).toBeLessThanOrEqual(0.7);
    const rec = await reconcileRun(db, user, run.id);
    expect(rec.unsettledEstimateUsd).toBe(0);
    expect(await listLiveClaims(db, user)).toEqual([]);
  });

  it('stops a run, naming the Actor minimum, when its max cost cannot fit under the cap', async () => {
    const w = world();
    // The Actor needs a max cost of $0.50; the cap leaves less, though the estimate is far lower.
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 0.4,
    });
    const end = await drive(w.orchestrator, user, run.id);
    expect(end.status).toBe('stopped_by_cap');
    const { rows } = await db.query<{ error: string }>('SELECT error FROM runs WHERE id = $1', [
      run.id,
    ]);
    expect(rows[0]!.error).toContain('Actor minimum');
    expect(rows[0]!.error).toContain('$0.5000');
    expect(w.apify.startsFor(GOOGLE_MAPS_ACTOR)).toHaveLength(0);
  });

  it('refuses to start a run once the monthly cap is spent, and caps steps by it', async () => {
    await setMonthlyCap(db, user, new Date(), 0.6);
    const w = world();
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    expect((await getRun(db, user, run.id))!.spentUsd).toBeLessThanOrEqual(0.6);
    await setMonthlyCap(db, user, new Date(), 0.001);
    await expect(
      w.orchestrator.startRun(user, { regionId: 'sfax', sectorIds: TEXTILE, budgetCapUsd: 10 }),
    ).rejects.toBeInstanceOf(RunStartError);
  });

  it('allows at most 2 concurrent runs per user (configurable)', async () => {
    await createRegionGrid(db, 'tunis', { south: 36.7, west: 10.0, north: 36.9, east: 10.3 }, 1, 2);
    await createRegionGrid(
      db,
      'sousse',
      { south: 35.7, west: 10.5, north: 35.9, east: 10.7 },
      1,
      2,
    );
    const w = world({ polls: 5 });
    const starts = await Promise.allSettled(
      ['sfax', 'tunis', 'sousse'].map((regionId) =>
        w.orchestrator.startRun(user, { regionId, sectorIds: TEXTILE, budgetCapUsd: 10 }),
      ),
    );
    expect(starts.filter((s) => s.status === 'fulfilled')).toHaveLength(2);
    const rejected = starts.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(RunLimitError);

    await createRegionGrid(
      db,
      'nabeul',
      { south: 36.4, west: 10.6, north: 36.6, east: 10.8 },
      1,
      2,
    );
    const three = world({}, { maxConcurrentRunsPerUser: 3 });
    await expect(
      three.orchestrator.startRun(user, {
        regionId: 'nabeul',
        sectorIds: TEXTILE,
        budgetCapUsd: 10,
      }),
    ).resolves.toMatchObject({ status: 'running' });
  });

  it('reports estimate vs actual per step, including Apify billing differences', async () => {
    const w = world({ billedFactor: 0.5 });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    const rec = await reconcileRun(db, user, run.id);
    const maps = rec.steps.filter((s) => s.stage === 'discover' && (s.actualUsd ?? 0) > 0);
    expect(maps.length).toBeGreaterThan(0);
    for (const s of maps) {
      // Apify billed half our priced events; the ledger follows the bill.
      expect(s.actualUsd).toBeCloseTo(s.reportedUsd!, 6);
      expect(s.items[0]!.actualUnits).toBe(2);
    }
    expect(rec.ledgerUsd).toBeCloseTo(rec.actualUsd + rec.unattributedUsd, 6);
  });
});

describe('orchestrator: concurrency', () => {
  it('lets two runs split the cells, never share one, and frees a dead run’s cells', async () => {
    const w = world({ polls: 2 });
    const [a, b] = await Promise.all([
      w.orchestrator.startRun(user, { regionId: 'sfax', sectorIds: TEXTILE, budgetCapUsd: 10 }),
      w.orchestrator.startRun(user, { regionId: 'sfax', sectorIds: TEXTILE, budgetCapUsd: 10 }),
    ]);
    const claims = await listLiveClaims(db, user);
    const cells = await listCells(db, 'sfax', { leafOnly: true });
    // Each cell is held by exactly one run.
    expect(claims.map((c) => c.regionCellId).sort()).toEqual(cells.map((c) => c.id).sort());
    const owners = new Set(claims.map((c) => c.runId));
    for (const run of [a!, b!]) {
      const steps = await listSteps(db, user, run.id);
      const mine = new Set(claims.filter((c) => c.runId === run.id).map((c) => c.regionCellId));
      expect(steps.every((s) => mine.has(s.regionCellId!))).toBe(true);
      if (!owners.has(run.id)) expect(run.status).toBe('failed');
    }

    // The holder of the first cell "dies": its claims lapse and a new run can take them.
    const holder = claims[0]!.runId;
    await db.query("UPDATE runs SET status = 'failed' WHERE id = $1", [holder]);
    await expireClaims(db, user, holder);
    const c = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    expect(c.status).toBe('running');
    const now = await listLiveClaims(db, user);
    expect(now.filter((x) => x.runId === c.id).map((x) => x.regionCellId)).toContain(
      claims[0]!.regionCellId,
    );
  });

  it('two runs finding the same company at the same moment store it once', async () => {
    // Every cell returns the same two places, so both runs find the same companies.
    await db.query('DELETE FROM region_cells');
    await createRegionGrid(db, 'sfax', SFAX, 1, 2);
    const fake = world({}, { cellsPerRun: 1, maxInFlightSteps: 1 });
    const same = fakePlace('shared', 0);
    fake.discovery.discoverCompanies = async (q, options) =>
      fake.apify.start(GOOGLE_MAPS_ACTOR, `${q.cellKey}|${q.normalizedQuery}`, [same], [], options);
    // Started one after the other so each claims its own cell; then both run at once.
    const a = await fake.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    const b = await fake.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    expect(b.status).toBe('running');
    await Promise.all([drive(fake.orchestrator, user, a.id), drive(fake.orchestrator, user, b.id)]);
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM companies WHERE user_id = $1',
      [user],
    );
    expect(rows[0]!.n).toBe(1);
    const firsts = [
      ...(await listRunCompanies(db, user, a.id)),
      ...(await listRunCompanies(db, user, b.id)),
    ].filter((c) => c.isNew);
    expect(firsts).toHaveLength(1);
  });

  it('a duplicate insert racing on place ID, domain or LinkedIn fails safely into a merge', async () => {
    const place = fakePlace('race', 0);
    const input = {
      name: place.name,
      governorate: { ...place.name, value: 'sfax', kind: 'estimate' as const },
      googlePlaceId: place.placeId,
      website: place.website!,
    };
    const c1 = await db.connect();
    const c2 = await db.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const first = await upsertCompany(c1, user, input);
      // The second insert blocks on the unique index until the first commits.
      const second = upsertCompany(c2, user, input);
      await new Promise((r) => setTimeout(r, 100));
      await c1.query('COMMIT');
      const merged = await second;
      await c2.query('COMMIT');
      expect(first.created).toBe(true);
      expect(merged.created).toBe(false);
      expect(merged.company.id).toBe(first.company.id);
    } finally {
      c1.release();
      c2.release();
    }
  });
});

describe('orchestrator: coverage and saturation', () => {
  it('exhausts wordings and cells, saturates the region and switches it to maintenance', async () => {
    const w = world({ polls: 0 }, { maxInFlightSteps: 8 });
    // Run 1: each cell's two places are found by the first wording; every other wording
    // finds nothing new and is exhausted.
    const r1 = await w.orchestrator.startRun(user, { regionId: 'sfax', budgetCapUsd: 50 });
    expect((await drive(w.orchestrator, user, r1.id)).status).toBe('finished');
    let stats = await listCellStats(db, user, 'sfax');
    expect(stats.every((c) => c.exhaustedAt === null)).toBe(true);
    const ex1 = await db.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM exhausted_queries WHERE user_id = $1',
      [user],
    );
    expect(ex1.rows[0]!.n).toBe(2 * (ALL_WORDINGS.length - 1));

    // Run 2 searches only the wordings still alive, finds nothing new: cells exhausted.
    const r2 = await w.orchestrator.startRun(user, { regionId: 'sfax', budgetCapUsd: 50 });
    expect(await listSteps(db, user, r2.id)).toHaveLength(2);
    expect((await drive(w.orchestrator, user, r2.id)).status).toBe('finished');
    stats = await listCellStats(db, user, 'sfax');
    expect(stats.every((c) => c.exhaustedAt !== null)).toBe(true);
    const region = (await listRegionStats(db, user)).find((r) => r.regionId === 'sfax')!;
    expect(region.mode).toBe('saturated');

    // A normal run has nothing left to search.
    const r3 = await w.orchestrator.startRun(user, { regionId: 'sfax', budgetCapUsd: 50 });
    expect(r3.status).toBe('failed');

    // The scheduler now proposes maintenance with ways to widen the search.
    const suggestion = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(suggestion.regionId).toBe('sfax');
    expect(suggestion.mode).toBe('maintenance');
    expect(suggestion.widening.join(' ')).toMatch(/Arabic/);

    // Maintenance: contacts older than 90 days are re-checked; cells re-searched on a slow
    // schedule pass only new places through the paid stages.
    await db.query(
      "UPDATE contacts SET updated_at = now() - interval '120 days' WHERE user_id = $1",
      [user],
    );
    await db.query(
      "UPDATE region_coverage SET last_run_at = now() - interval '40 days' WHERE user_id = $1",
      [user],
    );
    const peopleBefore = w.apify.startsFor('harvestapi/linkedin-company-employees').length;
    const m = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      budgetCapUsd: 50,
      mode: 'maintenance',
    });
    expect(m.mode).toBe('maintenance');
    expect((await drive(w.orchestrator, user, m.id)).status).toBe('finished');
    const companies = await listRunCompanies(db, user, m.id);
    expect(companies.filter((c) => c.isNew)).toHaveLength(0);
    // Every known company with stale contacts was re-checked, nothing else.
    expect(w.apify.startsFor('harvestapi/linkedin-company-employees').length - peopleBefore).toBe(
      4,
    );
  }, 60_000);

  it('suggests an explore run one time in five, and explains each choice', async () => {
    await createRegionGrid(db, 'tunis', { south: 36.7, west: 10.0, north: 36.9, east: 10.3 }, 1, 2);
    const w = world({ polls: 0 });
    // Stand-in history with no leads: the least-covered region goes first.
    await db.query(
      `INSERT INTO runs (user_id, region_id, budget_cap_usd, status) VALUES ($1, 'sfax', 1, 'failed')`,
      [user],
    );
    let s = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(s.reason).toMatch(/No region has produced leads yet/);
    await db.query('DELETE FROM runs WHERE user_id = $1', [user]);

    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    s = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(s.regionId).toBe('sfax');
    expect(s.reason).toMatch(/best yield/);

    // Runs 2 to 4 (stand-ins), so the next one is the fifth.
    for (let i = 0; i < 3; i++) {
      await db.query(
        `INSERT INTO runs (user_id, region_id, budget_cap_usd, status) VALUES ($1, 'sfax', 1, 'finished')`,
        [user],
      );
    }
    s = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(s.regionId).toBe('tunis');
    expect(s.reason).toMatch(/explore run/);
  });
});

describe('orchestrator: the suggestion with no history', () => {
  it('suggests nothing until the user has run something, instead of the first region alphabetically', async () => {
    await createRegionGrid(db, 'tunis', { south: 36.7, west: 10.0, north: 36.9, east: 10.3 }, 1, 2);
    const w = world();
    const s = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(s.regionId).toBeNull();
    expect(s.reason).toBe(NO_HISTORY_REASON);
    expect(s.reason).toBe(
      'Pick a region to start. We recommend a small one like Sfax for a first test.',
    );
    expect(s.widening).toEqual([]);
  });

  it('says "not planned yet" for a region with no cells, and keeps ranking once there is history', async () => {
    await setRegionBounds(db, 'sousse', { south: 35.7, west: 10.5, north: 35.9, east: 10.7 });
    const w = world();
    await db.query(
      `INSERT INTO runs (user_id, region_id, budget_cap_usd, status) VALUES ($1, 'sfax', 1, 'failed')`,
      [user],
    );
    const s = await suggestNextRegion(db, user, w.orchestrator.config);
    expect(s.regionId).toBe('sousse');
    expect(s.reason).toContain('not planned yet');
    expect(s.reason).not.toContain('?');
  });
});

describe('orchestrator: the Claude classifier', () => {
  /** Answers every company "qualified" and bills 500 input and 40 output tokens per call. */
  function fakeClaude() {
    const calls: unknown[] = [];
    const http: HttpJson = async <T>(_url: string, options: RequestOptions = {}) => {
      calls.push(options.body);
      return {
        model: 'claude-haiku-5-5',
        content: [
          {
            type: 'text',
            text: '{"verdict":"qualified","reasons":["makes goods"],"fields":["name"]}',
          },
        ],
        usage: { input_tokens: 500, output_tokens: 40 },
      } as T;
    };
    const claude = new AnthropicClassifier('sk-ant-test', { model: 'claude-haiku-5-5', http });
    return { calls, claude };
  }
  const qualifications = async (runId: string) =>
    (await listRunCompanies(db, user, runId)).map(
      (rc) =>
        (rc.payload as { qualification?: { verdict: string; reasons: string[] } }).qualification,
    );

  it('decides what the rules cannot, bills it to the ledger as anthropic, and keeps the evidence', async () => {
    const { calls, claude } = fakeClaude();
    const w = world({ undecided: true }, {}, { companyClassifier: claude });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    expect(calls.length).toBeGreaterThan(0);
    const spent = await runSpendByProvider(db, user, run.id, 'anthropic');
    // 500 x $1/M + 40 x $5/M per call.
    expect(spent).toBeCloseTo(calls.length * 0.0007, 6);
    const rows = await listLedgerForRun(db, user, run.id);
    expect(rows.filter((e) => e.provider === 'anthropic').every((e) => e.kind === 'actual')).toBe(
      true,
    );
    const companies = await listRunCompanies(db, user, run.id);
    const evidence = await listEvidence(db, user, { companyId: companies[0]!.companyId });
    expect(evidence.find((e) => e.field === 'classifier_name')?.kind).toBe('estimate');
    expect(evidence.find((e) => e.field === 'classifier_verdict')?.value).toMatch(/^qualified:/);
  });

  it('stops calling the classifier once its spend cap for the run is reached', async () => {
    const { calls, claude } = fakeClaude();
    // Each call bills $0.0007: the second reaches the $0.001 cap.
    const w = world(
      { undecided: true },
      { classifierRunCapUsd: 0.001 },
      { companyClassifier: claude },
    );
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    expect(calls).toHaveLength(2);
    const q = await qualifications(run.id);
    expect(q.filter((x) => x?.verdict === 'qualified')).toHaveLength(2);
    const skipped = q.filter((x) => x?.verdict === 'review');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]!.reasons[0]).toContain('classifier spend cap');
  });

  it('is not used at all when no classifier is configured', async () => {
    const w = world({ undecided: true });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    expect(await runSpendByProvider(db, user, run.id, 'anthropic')).toBe(0);
    expect((await qualifications(run.id)).every((x) => x?.verdict === 'review')).toBe(true);
  });
});

describe('orchestrator: places outside the governorate', () => {
  // Outline over the west half of the Sfax box only.
  const WEST_HALF = {
    type: 'Polygon',
    coordinates: [
      [
        [10.5, 34.6],
        [10.7, 34.6],
        [10.7, 34.9],
        [10.5, 34.9],
        [10.5, 34.6],
      ],
    ],
  };
  const INSIDE = { lat: 34.7, lng: 10.6 };
  const OUTSIDE = { lat: 34.7, lng: 10.8 };

  async function runWith(locationOf: NonNullable<FakeApifyOptions['locationOf']>) {
    await db.query('UPDATE regions SET outline = $1 WHERE id = $2', [
      JSON.stringify(WEST_HALF),
      'sfax',
    ]);
    const w = world({ locationOf });
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    return { run, companies: await listRunCompanies(db, user, run.id) };
  }

  it('drops places whose coordinates are outside the outline before they are stored, and counts them', async () => {
    const { run, companies } = await runWith((_cell, i) => (i === 0 ? INSIDE : OUTSIDE));
    // 2 cells x 2 wordings x 2 places = 8 sightings; the second place of each is outside.
    expect((await getRun(db, user, run.id))?.placesDroppedOutside).toBe(4);
    expect(companies).toHaveLength(2);
    expect(companies.every((c) => c.state === 'scored')).toBe(true);
    const names = await db.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM companies WHERE user_id = $1',
      [user],
    );
    expect(names.rows[0]!.n).toBe(2);
  });

  it('keeps places without coordinates, which cannot be judged', async () => {
    const { run, companies } = await runWith((_cell, i) => (i === 0 ? INSIDE : null));
    expect((await getRun(db, user, run.id))?.placesDroppedOutside).toBe(0);
    expect(companies).toHaveLength(4);
  });

  it('forgives a place a few hundred metres outside the simplified edge', async () => {
    const { run } = await runWith(() => ({ lat: 34.7, lng: 10.7 + 0.002 }));
    expect((await getRun(db, user, run.id))?.placesDroppedOutside).toBe(0);
  });
});

describe('orchestrator: first-run fixes', () => {
  async function finished(opts: FakeApifyOptions, extra: Partial<OrchestratorDeps> = {}) {
    const w = world(opts, {}, extra);
    const run = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, run.id);
    return { w, run };
  }

  it('keeps a company with no phone, website or email as unreachable and never scores it', async () => {
    const { run } = await finished({ unreachable: true });
    const companies = await listRunCompanies(db, user, run.id);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c.state === 'unreachable')).toBe(true);
    expect(await listLeads(db, user, { runId: run.id })).toEqual([]);
    expect((await getRun(db, user, run.id))?.status).toBe('finished');
    // Counted as unreachable, not as leads.
    const [summary] = await runSummaries(db, user, [run.id]);
    expect(summary!.funnel.unreachable).toBe(companies.length);
    expect(summary!.funnel.leads).toBe(0);
    expect(summary!.funnel.qualified).toBeGreaterThanOrEqual(companies.length);
  });

  it('logs, per company, the search input, how many people came back and why each was rejected', async () => {
    const logs: { data: Record<string, unknown>; message: string }[] = [];
    const { run } = await finished({}, { log: (data, message) => logs.push({ data, message }) });
    const people = logs.filter((l) => l.message === 'people step result');
    expect(people.length).toBeGreaterThan(0);
    const first = people[0]!.data as {
      runId: string;
      company: string;
      input: { companyName: string; location: string };
      returned: number;
      kept: number;
      rejected: unknown[];
    };
    expect(first.runId).toBe(run.id);
    expect(first.input.companyName).toBe(first.company);
    expect(first.returned).toBe(1);
    expect(first.kept).toBe(1);
    expect(first.rejected).toEqual([]);
    const stored = (await listRunCompanies(db, user, run.id))[0]!.payload as {
      peopleDiagnostics?: { returned: number };
    };
    expect(stored.peopleDiagnostics?.returned).toBe(1);
  });

  it('finds a decision-maker from a short company-list profile with a French filler-word title', async () => {
    const logs: Record<string, unknown>[] = [];
    const { run } = await finished({ sparsePeople: true }, { log: (data) => logs.push(data) });
    const leads = await listLeads(db, user, { runId: run.id });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.contactId)).toBe(true);
    expect(logs.every((l) => (l.rejected as unknown[]).length === 0)).toBe(true);
  });

  it('stores the score reasons on each lead', async () => {
    const { run } = await finished({});
    const leads = await listLeads(db, user, { runId: run.id });
    const loaded = await loadLeads(
      db,
      user,
      leads.map((l) => l.id),
    );
    expect(loaded.every((l) => (l.scoreReasons?.length ?? 0) > 0)).toBe(true);
    const stored = await db.query<{ score_reasons: { component: string; reason: string }[] }>(
      'SELECT score_reasons FROM crm_leads WHERE user_id = $1 AND run_id = $2',
      [user, run.id],
    );
    expect(stored.rows).toHaveLength(leads.length);
    for (const row of stored.rows) {
      expect(row.score_reasons.length).toBeGreaterThan(0);
      expect(row.score_reasons.every((r) => r.reason !== '')).toBe(true);
    }
  });

  it('records what each step came to, for the Apify log', async () => {
    const { run } = await finished({
      noDecisionMakers: true,
      locationOf: (_c, i) => (i === 0 ? { lat: 34.7, lng: 10.6 } : null),
    });
    const steps = await apifySteps(db, user, { runIds: [run.id] });
    const discover = steps.filter((s) => s.stage === 'discover');
    expect(discover.length).toBeGreaterThan(0);
    for (const s of discover) {
      expect(s.target.query).toBeTruthy();
      expect(s.target.cell).toBeTruthy();
      expect(s.summary).toMatchObject({ returned: 2 });
      expect(s.durationSeconds).not.toBeNull();
      expect(s.costUsd).toBeGreaterThan(0);
    }
    // The first wording in a cell finds new places; a later wording finds the same ones.
    expect(discover.some((s) => s.summary!.kept === 2 && s.summary!.dropped.length === 0)).toBe(
      true,
    );
    expect(
      discover.some((s) =>
        s.summary!.dropped.some((d) => d.reason === 'already_known' && d.count === 2),
      ),
    ).toBe(true);

    const people = steps.filter((s) => s.stage === 'find_people');
    expect(people.length).toBeGreaterThan(0);
    for (const s of people) {
      expect(s.target.company).toBeTruthy();
      expect(s.summary?.people).toMatchObject({
        found: 1,
        decisionMakers: 0,
        reasons: [{ reason: 'no_matching_title', count: 1 }],
      });
    }
  });

  it('records a dropped place and a place with no contact in the discover summary', async () => {
    await db.query('UPDATE regions SET outline = $1 WHERE id = $2', [
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [10.5, 34.6],
            [10.7, 34.6],
            [10.7, 34.9],
            [10.5, 34.9],
            [10.5, 34.6],
          ],
        ],
      }),
      'sfax',
    ]);
    const { run } = await finished({
      unreachable: true,
      locationOf: (_c, i) => (i === 0 ? { lat: 34.7, lng: 10.6 } : { lat: 34.7, lng: 10.8 }),
    });
    const discover = (await apifySteps(db, user, { runIds: [run.id] })).filter(
      (s) => s.stage === 'discover',
    );
    const first = discover.find((s) => s.summary!.dropped.some((d) => d.reason === 'no_contact'));
    expect(first?.summary).toMatchObject({
      returned: 2,
      kept: 0,
      dropped: [
        { reason: 'outside_region', count: 1 },
        { reason: 'no_contact', count: 1 },
      ],
    });
  });
});

describe('orchestrator: removed CRM cards', () => {
  it('skips a company whose Noise card was purged instead of finding it again', async () => {
    const w = world();
    const first = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, first.id);
    const { rows: cards } = await db.query<{ id: string; company_id: string }>(
      "SELECT id, company_id FROM crm_cards WHERE user_id = $1 AND pipeline = 'companies' ORDER BY created_at",
      [user],
    );
    expect(cards).toHaveLength(4);
    const gone = cards[0]!;
    const { rows: places } = await db.query<{ google_place_id: string }>(
      'SELECT google_place_id FROM companies WHERE id = $1',
      [gone.company_id],
    );
    await removeCard(db, user, gone.id);
    await purgeNoise(db, 30, new Date(Date.now() + 31 * 86_400_000));
    expect(
      (await db.query('SELECT 1 FROM companies WHERE id = $1', [gone.company_id])).rows,
    ).toEqual([]);

    // Forget what the first run searched, so a second run looks at the same places again.
    await db.query('DELETE FROM search_queries');
    await db.query('DELETE FROM exhausted_queries');
    const second = await w.orchestrator.startRun(user, {
      regionId: 'sfax',
      sectorIds: TEXTILE,
      budgetCapUsd: 10,
    });
    await drive(w.orchestrator, user, second.id);

    const { rows: again } = await db.query('SELECT 1 FROM companies WHERE google_place_id = $1', [
      places[0]!.google_place_id,
    ]);
    expect(again).toEqual([]);
    const { rows: n } = await db.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM companies',
    );
    expect(n[0]!.n).toBe(3);
    const discover = (await apifySteps(db, user, { runIds: [second.id] })).filter(
      (s) => s.stage === 'discover',
    );
    expect(discover.length).toBeGreaterThan(0);
    expect(discover.some((s) => s.summary!.dropped.some((d) => d.reason === 'already_known'))).toBe(
      true,
    );
  });
});
