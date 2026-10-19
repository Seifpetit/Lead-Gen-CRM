import type { RunProblem, RunStage } from '@lead-gen-crm/shared';
import { getProviderHealth } from '../data/appErrors.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import {
  clearEndedRunProblems,
  getRunProblem,
  runLastActivity,
  runSettledSpend,
  setRunProblem,
} from '../data/runHealth.js';
import { getRun, listUnfinishedRunIds, listUsersWithUnfinishedWork } from '../data/runs.js';
import { isSpendingFast, isStuck } from '../lib/anomaly.js';
import type { RunChanges } from './changes.js';

export interface WatchdogConfig {
  /** Minutes without progress after which a run "may be stuck". 0 turns the check off. */
  stuckMinutes: number;
  /** Warn when a run's settled steps cost more than this many times their estimate. 0 = off. */
  spendFactor: number;
  /** Overruns smaller than this are not worth a warning (USD). */
  spendFloorUsd: number;
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  stuckMinutes: 20,
  spendFactor: 2,
  spendFloorUsd: 0.25,
};

/** The step of the pipeline in words that fit "stuck on ...". */
const STAGE_WORDS: Record<RunStage, string> = {
  discover: 'searching Google Maps',
  qualify: 'checking companies',
  find_people: 'finding people',
  enrich: 'finding contacts',
  verify: 'checking contact details',
  score: 'scoring',
};
const PAID_STAGES: readonly RunStage[] = ['discover', 'find_people', 'enrich'];

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Looks over every run in progress and says what is wrong with it, in plain words: a provider
 * that is down, no progress for a while, or spending running ahead of the estimate. Runs on a
 * timer and when asked; it only writes `runs.problem`, never changes a run's course.
 */
export class Watchdog {
  constructor(
    private readonly deps: { db: Db; changes?: RunChanges; config?: Partial<WatchdogConfig> },
  ) {}

  private get config(): WatchdogConfig {
    return { ...DEFAULT_WATCHDOG_CONFIG, ...this.deps.config };
  }

  /** One pass over every run in progress. Returns how many problems changed. */
  async check(now = new Date()): Promise<number> {
    const { db } = this.deps;
    let changed = 0;
    await clearEndedRunProblems(db);
    for (const userId of await listUsersWithUnfinishedWork(db)) {
      for (const runId of await listUnfinishedRunIds(db, userId)) {
        if (await this.checkRun(userId, runId, now)) changed++;
      }
    }
    return changed;
  }

  /** What is wrong with one run now, or null. Exposed so a test can ask without writing. */
  async assess(userId: UserId, runId: string, now = new Date()): Promise<RunProblem | null> {
    const { db } = this.deps;
    const run = await getRun(db, userId, runId);
    if (!run || (run.status !== 'running' && run.status !== 'pending')) return null;
    const previous = await getRunProblem(db, userId, runId);
    const since = (kind: RunProblem['kind'], fallback: Date) =>
      previous?.kind === kind ? previous.since : fallback.toISOString();

    const apify = await getProviderHealth(db, 'apify');
    if (
      apify?.state === 'down' &&
      apify.reason &&
      run.currentStage &&
      PAID_STAGES.includes(run.currentStage)
    ) {
      return {
        kind: 'provider_down',
        message: apify.reason,
        since: since('provider_down', apify.since ? new Date(apify.since) : now),
        action: 'stop',
      };
    }

    const last = (await runLastActivity(db, userId, runId)) ?? new Date(run.createdAt);
    if (isStuck({ lastActivity: last, now, minutes: this.config.stuckMinutes })) {
      const where = run.currentStage ? ` while ${STAGE_WORDS[run.currentStage]}` : '';
      return {
        kind: 'stuck',
        message: `This run looks stuck${where}`,
        since: since('stuck', last),
        action: 'recheck',
      };
    }

    const spend = await runSettledSpend(db, userId, runId);
    if (
      isSpendingFast({
        ...spend,
        factor: this.config.spendFactor,
        floorUsd: this.config.spendFloorUsd,
      })
    ) {
      return {
        kind: 'spend_fast',
        message: `Spending is ahead of the estimate: ${money(spend.actualUsd)} against ${money(spend.estimatedUsd)} expected for the steps done so far`,
        since: since('spend_fast', now),
        action: 'stop',
      };
    }

    // A retry in progress is set by the orchestrator, and stays until the next step lands.
    return previous?.kind === 'retrying' ? previous : null;
  }

  private async checkRun(userId: UserId, runId: string, now: Date): Promise<boolean> {
    const problem = await this.assess(userId, runId, now);
    const changed = await setRunProblem(this.deps.db, userId, runId, problem);
    if (changed) this.deps.changes?.notify(userId);
    return changed;
  }
}
