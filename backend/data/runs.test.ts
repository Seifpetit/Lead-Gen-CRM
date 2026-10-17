import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ApifyState,
  listApifyEventsForRun,
  listRecentApifyEvents,
  recordApifyEvent,
} from './apifyEvents.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { getCoverage, listCoverage, upsertCoverage } from './regionCoverage.js';
import { addRunSpend, createRun, getRun, listRuns, updateRun } from './runs.js';
import {
  ensureStep,
  listSteps,
  listUnfinishedSteps,
  recordApifyStart,
  StepStateError,
  updateStepStatus,
} from './runSteps.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

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
  user = await makeUser(db);
});

describe('runs', () => {
  it('tracks status transitions and spend', async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    expect(run).toMatchObject({ status: 'pending', spentUsd: 0, spendCapUsd: 10, region: 'sfax' });
    await updateRun(db, user, run.id, { status: 'running', currentStage: 'discover' });
    expect(await addRunSpend(db, user, run.id, 1.25)).toBe(1.25);
    const done = await updateRun(db, user, run.id, { status: 'finished', currentStage: null });
    expect(done).toMatchObject({ status: 'finished', currentStage: null, spentUsd: 1.25 });
    expect(done?.finishedAt).not.toBeNull();
  });

  it('rejects a run without a positive spend cap', async () => {
    await expect(createRun(db, user, { regionId: 'sfax', spendCapUsd: 0 })).rejects.toThrow();
  });

  it("hides one user's runs from another", async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const other = await makeUser(db);
    expect(await getRun(db, other, run.id)).toBeNull();
    expect(await listRuns(db, other)).toEqual([]);
    expect(await updateRun(db, other, run.id, { status: 'cancelled' })).toBeNull();
  });
});

describe('run steps', () => {
  it('stores Apify run and dataset IDs when starting, and never starts a step twice', async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const input = {
      runId: run.id,
      stage: 'discover',
      stepKey: 'maps:sfax',
      actorId: 'compass/crawler-google-places',
    } as const;
    const step = (await ensureStep(db, user, input))!;
    expect((await ensureStep(db, user, input))!.id).toBe(step.id);

    const started = await recordApifyStart(db, user, step.id, {
      apifyRunId: 'apify-run-1',
      apifyDatasetId: 'ds-1',
    });
    expect(started).toMatchObject({
      status: 'started',
      apifyRunId: 'apify-run-1',
      apifyDatasetId: 'ds-1',
    });
    expect(started.startedAt).not.toBeNull();
    await expect(
      recordApifyStart(db, user, step.id, { apifyRunId: 'apify-run-2', apifyDatasetId: 'ds-2' }),
    ).rejects.toThrow(StepStateError);

    expect((await listUnfinishedSteps(db, user)).map((s) => s.id)).toEqual([step.id]);
    await updateStepStatus(db, user, step.id, 'finished', { costUsd: 0.4 });
    expect(await listUnfinishedSteps(db, user)).toEqual([]);
    expect((await listSteps(db, user, run.id))[0]).toMatchObject({
      status: 'finished',
      costUsd: 0.4,
    });
  });

  it('the database refuses an Apify step past pending without its IDs', async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const step = (await ensureStep(db, user, {
      runId: run.id,
      stage: 'discover',
      stepKey: 'k',
      actorId: 'a/b',
    }))!;
    await expect(updateStepStatus(db, user, step.id, 'running')).rejects.toThrow(
      /check constraint/,
    );
  });

  it("cannot add a step to another user's run", async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const other = await makeUser(db);
    expect(
      await ensureStep(db, other, { runId: run.id, stage: 'discover', stepKey: 'k' }),
    ).toBeNull();
  });
});

describe('apify events', () => {
  it('records each state change of a run for the log widget', async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const step = (await ensureStep(db, user, {
      runId: run.id,
      stage: 'discover',
      stepKey: 'k',
      actorId: 'a/b',
    }))!;
    await recordApifyStart(db, user, step.id, { apifyRunId: 'r1', apifyDatasetId: 'd1' });
    const states = ['started', 'running', 'restarting', 'resumed', 'finished'] as const;
    for (const [i, state] of states.entries()) {
      await recordApifyEvent(db, user, {
        runStepId: step.id,
        state,
        occurredAt: new Date(Date.UTC(2026, 9, 1, 10, i)),
      });
    }
    expect((await listApifyEventsForRun(db, user, run.id)).map((e) => e.state)).toEqual(states);
    const recent = await listRecentApifyEvents(db, user, 2);
    expect(recent.map((e) => e.state)).toEqual(['finished', 'resumed']);
    expect(recent[0]).toMatchObject({ apifyRunId: 'r1', runId: run.id });

    const other = await makeUser(db);
    expect(await recordApifyEvent(db, other, { runStepId: step.id, state: 'failed' })).toBeNull();
    expect(await listRecentApifyEvents(db, other)).toEqual([]);
  });

  it('rejects an unknown state', async () => {
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const step = (await ensureStep(db, user, {
      runId: run.id,
      stage: 'discover',
      stepKey: 'k',
      actorId: 'a/b',
    }))!;
    await recordApifyStart(db, user, step.id, { apifyRunId: 'r1', apifyDatasetId: 'd1' });
    // Bypasses the type on purpose: the database is the last line of defense.
    const state = 'paused' as ApifyState;
    await expect(recordApifyEvent(db, user, { runStepId: step.id, state })).rejects.toThrow();
  });
});

describe('region coverage', () => {
  it('stores per-region yield and lists every governorate', async () => {
    await upsertCoverage(db, user, 'sfax', {
      placesFound: 2500,
      qualifiedShare: 0.12,
      costPerLeadUsd: 0.75,
    });
    const c = await upsertCoverage(db, user, 'sfax', {
      decisionMakerShare: 0.5,
      channelShare: 0.66,
    });
    expect(c).toMatchObject({
      placesFound: 2500,
      qualifiedShare: 0.12,
      decisionMakerShare: 0.5,
      channelShare: 0.66,
      costPerLeadUsd: 0.75,
    });

    const all = await listCoverage(db, user);
    expect(all).toHaveLength(24);
    expect(all.find((r) => r.regionId === 'tunis')).toMatchObject({
      placesFound: 0,
      qualifiedShare: null,
    });

    const other = await makeUser(db);
    expect(await getCoverage(db, other, 'sfax')).toBeNull();
  });

  it('rejects a share outside 0..1', async () => {
    await expect(upsertCoverage(db, user, 'sfax', { qualifiedShare: 1.5 })).rejects.toThrow();
  });
});
