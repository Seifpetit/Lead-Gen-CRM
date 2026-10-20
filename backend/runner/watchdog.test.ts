import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markProviderFailed, markProviderOk } from '../data/appErrors.js';
import { recordCost, settleStepCosts } from '../data/costLedger.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRegionGrid } from '../data/regionCells.js';
import { getRunProblem, setRunProblem } from '../data/runHealth.js';
import { listSteps } from '../data/runSteps.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import type { Bounds } from '../lib/geo.js';
import { fakeProviders } from '../test/fakeProviders.js';
import { RunChanges } from './changes.js';
import { Orchestrator } from './orchestrator.js';
import { Watchdog } from './watchdog.js';

// The watchdog's verdicts, from the facts in the database. No network and no paid calls.

const SFAX: Bounds = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };

let db: Db;
let user: UserId;
let orchestrator: Orchestrator;
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
  const fake = fakeProviders({ polls: 1 });
  orchestrator = new Orchestrator({
    db,
    discovery: fake.discovery,
    people: fake.people,
    emails: fake.emails,
    config: { cellsPerRun: 2 },
  });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
});

const startRun = () =>
  orchestrator.startRun(user, { regionId: 'sfax', sectorIds: ['textile'], budgetCapUsd: 10 });

const minutesLater = (m: number) => new Date(Date.now() + m * 60_000);

describe('stuck runs', () => {
  it('says nothing about a run that just did something', async () => {
    const run = await startRun();
    const dog = new Watchdog({ db });
    expect(await dog.assess(user, run.id, new Date())).toBeNull();
  });

  it('says "may be stuck" with the step once nothing has happened for the set minutes', async () => {
    const run = await startRun();
    const dog = new Watchdog({ db, config: { stuckMinutes: 20 } });
    expect(await dog.assess(user, run.id, minutesLater(19))).toBeNull();
    const problem = await dog.assess(user, run.id, minutesLater(25));
    expect(problem).toMatchObject({ kind: 'stuck', action: 'recheck' });
    expect(problem!.message).toMatch(/^This run looks stuck/);
    expect(new Date(problem!.since).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('is switched off by 0 minutes', async () => {
    const run = await startRun();
    const dog = new Watchdog({ db, config: { stuckMinutes: 0 } });
    expect(await dog.assess(user, run.id, minutesLater(600))).toBeNull();
  });
});

describe('a provider that is down', () => {
  it('shows the plain reason with a stop action on a run in a paid step', async () => {
    const run = await startRun();
    await db.query("UPDATE runs SET current_stage = 'discover' WHERE id = $1", [run.id]);
    await markProviderFailed(
      db,
      'apify',
      { kind: 'out_of_credit', reason: 'Apify is out of credit: top up and start a new run' },
      () => 'down',
    );
    const problem = await new Watchdog({ db }).assess(user, run.id);
    expect(problem).toMatchObject({
      kind: 'provider_down',
      message: 'Apify is out of credit: top up and start a new run',
      action: 'stop',
    });
    await markProviderOk(db, 'apify');
    expect(await new Watchdog({ db }).assess(user, run.id)).toBeNull();
  });
});

describe('spending faster than the estimate', () => {
  async function stepWithSpend(estimate: number, actual: number) {
    const run = await startRun();
    await orchestrator.advance(user, run.id);
    const [step] = await listSteps(db, user, run.id);
    await recordCost(db, user, {
      runId: run.id,
      runStepId: step!.id,
      provider: 'apify',
      item: 'x',
      units: 1,
      unitPriceUsd: estimate,
      kind: 'estimated',
    });
    await settleStepCosts(db, user, {
      runId: run.id,
      runStepId: step!.id,
      actuals: [{ provider: 'apify', item: 'x', units: 1, unitPriceUsd: actual }],
    });
    return run;
  }

  it('warns, with both amounts, when actual is over the factor and the floor', async () => {
    const run = await stepWithSpend(0.2, 0.9);
    const problem = await new Watchdog({ db }).assess(user, run.id);
    expect(problem).toMatchObject({ kind: 'spend_fast', action: 'stop' });
    expect(problem!.message).toContain('$0.90');
    expect(problem!.message).toMatch(/against \$0\.\d\d expected/);
  });

  it('stays quiet for a small overrun', async () => {
    const run = await stepWithSpend(0.1, 0.25);
    expect(await new Watchdog({ db }).assess(user, run.id)).toBeNull();
  });
});

describe('check', () => {
  it('writes the problem, tells listeners once, and clears it when the cause is gone', async () => {
    const run = await startRun();
    const changes = new RunChanges();
    const notify = vi.spyOn(changes, 'notify');
    const dog = new Watchdog({ db, changes, config: { stuckMinutes: 20 } });

    expect(await dog.check(minutesLater(30))).toBe(1);
    expect((await getRunProblem(db, user, run.id))?.kind).toBe('stuck');
    expect(notify).toHaveBeenCalledTimes(1);

    // Same verdict again: nothing changes, nobody is woken.
    expect(await dog.check(minutesLater(31))).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);

    expect(await dog.check(new Date())).toBe(1);
    expect(await getRunProblem(db, user, run.id)).toBeNull();
  });

  it('keeps the original "since" while the same problem goes on', async () => {
    const run = await startRun();
    const dog = new Watchdog({ db, config: { stuckMinutes: 20 } });
    await dog.check(minutesLater(30));
    const first = (await getRunProblem(db, user, run.id))!.since;
    await dog.check(minutesLater(50));
    expect((await getRunProblem(db, user, run.id))!.since).toBe(first);
  });

  it('keeps a retry notice set by the runner and drops problems of runs that ended', async () => {
    const run = await startRun();
    const retrying = {
      kind: 'retrying' as const,
      message: 'Searching again after a provider hiccup',
      since: new Date().toISOString(),
      action: null,
    };
    await setRunProblem(db, user, run.id, retrying);
    const dog = new Watchdog({ db });
    await dog.check();
    expect(await getRunProblem(db, user, run.id)).toEqual(retrying);

    await db.query("UPDATE runs SET status = 'failed' WHERE id = $1", [run.id]);
    await dog.check();
    expect(await getRunProblem(db, user, run.id)).toBeNull();
  });
});
