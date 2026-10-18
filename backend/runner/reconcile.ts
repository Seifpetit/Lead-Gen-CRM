import { listLedgerForRun, type CostEntry } from '../data/costLedger.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { listSteps } from '../data/runSteps.js';

// Compares what each step was estimated to cost with what the provider reported. Read-only:
// the ledger is append-only and settling happens in the orchestrator (settleStepCosts).

export interface ItemDifference {
  provider: CostEntry['provider'];
  item: string;
  estimatedUnits: number;
  actualUnits: number;
  estimatedUsd: number;
  actualUsd: number;
}

export interface StepReconciliation {
  runStepId: string;
  stage: string;
  stepKey: string;
  status: string;
  /** Sum of the step's original estimates (before reversal). */
  estimatedUsd: number;
  /** Sum of the step's actual entries; null while the step is unsettled. */
  actualUsd: number | null;
  /** actual - estimate; null while unsettled. */
  differenceUsd: number | null;
  /** What Apify said the run cost (usageTotalUsd), when it said so. */
  reportedUsd: number | null;
  /** Estimates still counting as spend (no actual entry has replaced them). */
  unsettledEstimateUsd: number;
  items: ItemDifference[];
}

export interface RunReconciliation {
  runId: string;
  estimatedUsd: number;
  actualUsd: number;
  /** Net spend as the ledger counts it (estimates still open plus actuals). */
  ledgerUsd: number;
  unsettledEstimateUsd: number;
  steps: StepReconciliation[];
  /** Steps whose actual differs from the estimate by more than the tolerance. */
  flagged: { runStepId: string; stepKey: string; differenceUsd: number; note: string }[];
  /** Ledger rows not tied to a step (e.g. LLM costs recorded per run). */
  unattributedUsd: number;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Reports, per step and per cost item, the estimate against the actual entry that replaced
 * it, and flags differences above `toleranceUsd` or `tolerancePct` (whichever is larger).
 * Also flags settled steps whose actual entries disagree with Apify's reported usage.
 */
export async function reconcileRun(
  db: Queryable,
  userId: UserId,
  runId: string,
  opts: { toleranceUsd?: number; tolerancePct?: number } = {},
): Promise<RunReconciliation> {
  const toleranceUsd = opts.toleranceUsd ?? 0.01;
  const tolerancePct = opts.tolerancePct ?? 0.2;
  const ledger = await listLedgerForRun(db, userId, runId);
  const steps = await listSteps(db, userId, runId);
  const reversed = new Set(ledger.filter((e) => e.correctsId).map((e) => e.correctsId));
  const originals = ledger.filter((e) => e.correctsId === null);

  const byStep = new Map<string | null, CostEntry[]>();
  for (const e of originals) byStep.set(e.runStepId, [...(byStep.get(e.runStepId) ?? []), e]);

  const result: RunReconciliation = {
    runId,
    estimatedUsd: 0,
    actualUsd: 0,
    ledgerUsd: round(ledger.reduce((s, e) => s + e.amountUsd, 0)),
    unsettledEstimateUsd: 0,
    steps: [],
    flagged: [],
    unattributedUsd: 0,
  };

  for (const step of steps) {
    const entries = byStep.get(step.id) ?? [];
    if (entries.length === 0) continue;
    const estimates = entries.filter((e) => e.kind === 'estimated');
    const actuals = entries.filter((e) => e.kind === 'actual');
    const estimatedUsd = round(estimates.reduce((s, e) => s + e.amountUsd, 0));
    const unsettledEstimateUsd = round(
      estimates.filter((e) => !reversed.has(e.id)).reduce((s, e) => s + e.amountUsd, 0),
    );
    const settled = actuals.length > 0 || (estimates.length > 0 && unsettledEstimateUsd === 0);
    const actualUsd = settled ? round(actuals.reduce((s, e) => s + e.amountUsd, 0)) : null;

    const items = new Map<string, ItemDifference>();
    for (const e of entries) {
      const key = `${e.provider}|${e.item}`;
      const it = items.get(key) ?? {
        provider: e.provider,
        item: e.item,
        estimatedUnits: 0,
        actualUnits: 0,
        estimatedUsd: 0,
        actualUsd: 0,
      };
      if (e.kind === 'estimated') {
        it.estimatedUnits += e.units;
        it.estimatedUsd = round(it.estimatedUsd + e.amountUsd);
      } else {
        it.actualUnits += e.units;
        it.actualUsd = round(it.actualUsd + e.amountUsd);
      }
      items.set(key, it);
    }

    const usage = (step.output as { usage?: { usageTotalUsd?: number | null } } | null)?.usage;
    const reportedUsd = usage?.usageTotalUsd ?? null;
    const differenceUsd = actualUsd === null ? null : round(actualUsd - estimatedUsd);
    result.steps.push({
      runStepId: step.id,
      stage: step.stage,
      stepKey: step.stepKey,
      status: step.status,
      estimatedUsd,
      actualUsd,
      differenceUsd,
      reportedUsd,
      unsettledEstimateUsd,
      items: [...items.values()],
    });
    result.estimatedUsd = round(result.estimatedUsd + estimatedUsd);
    result.actualUsd = round(result.actualUsd + (actualUsd ?? 0));
    result.unsettledEstimateUsd = round(result.unsettledEstimateUsd + unsettledEstimateUsd);

    if (differenceUsd !== null) {
      const limit = Math.max(toleranceUsd, estimatedUsd * tolerancePct);
      if (Math.abs(differenceUsd) > limit) {
        result.flagged.push({
          runStepId: step.id,
          stepKey: step.stepKey,
          differenceUsd,
          note: `${differenceUsd > 0 ? 'Over' : 'Under'} estimate by $${Math.abs(differenceUsd).toFixed(4)} (estimate $${estimatedUsd.toFixed(4)})`,
        });
      }
      if (reportedUsd !== null && Math.abs(reportedUsd - (actualUsd ?? 0)) > toleranceUsd) {
        result.flagged.push({
          runStepId: step.id,
          stepKey: step.stepKey,
          differenceUsd: round((actualUsd ?? 0) - reportedUsd),
          note: `Ledger actual $${(actualUsd ?? 0).toFixed(4)} differs from Apify's reported $${reportedUsd.toFixed(4)}`,
        });
      }
    } else if (step.status === 'finished' || step.status === 'failed') {
      if (unsettledEstimateUsd > 0 && step.provider && step.provider.includes('/')) {
        result.flagged.push({
          runStepId: step.id,
          stepKey: step.stepKey,
          differenceUsd: 0,
          note: `Finished but never settled: $${unsettledEstimateUsd.toFixed(4)} estimate still counted (no usage from Apify)`,
        });
      }
    }
  }
  result.unattributedUsd = round(
    ledger.filter((e) => e.runStepId === null).reduce((s, e) => s + e.amountUsd, 0),
  );
  return result;
}
