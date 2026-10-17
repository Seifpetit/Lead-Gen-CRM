import { withTransaction, type Queryable } from './db.js';
import type { UserId } from './ids.js';

/**
 * Append-only record of every dollar spent. Rows are never updated or deleted (a database
 * trigger refuses it); a correction is a new row with the opposite amount. Run, month and
 * cost-per-lead totals are always sums over this table.
 */

export type CostProvider = 'apify' | 'google' | 'llm';
export type CostKind = 'estimated' | 'actual';

export interface CostEntryInput {
  runId: string;
  runStepId?: string | null;
  /** The map cell the spend was for, so cost per lead can be computed per cell. */
  regionCellId?: string | null;
  provider: CostProvider;
  /** What was bought: Apify actor ID, Google SKU, LLM model. */
  item: string;
  units: number;
  unitPriceUsd: number;
  kind: CostKind;
}

export interface CostEntry {
  id: string;
  runId: string;
  runStepId: string | null;
  regionCellId: string | null;
  provider: CostProvider;
  item: string;
  units: number;
  unitPriceUsd: number;
  amountUsd: number;
  kind: CostKind;
  correctsId: string | null;
  reconciledAt: Date | null;
  createdAt: Date;
}

export interface CostRecorded {
  entry: CostEntry;
  runSpentUsd: number;
  runBudgetCapUsd: number;
  monthSpentUsd: number;
  monthCapUsd: number | null;
  /** True when this entry pushed the run to its cap or the month to its cap, and the run was stopped. */
  stoppedByCap: boolean;
}

export class CostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostError';
  }
}

interface Row {
  id: string;
  run_id: string;
  run_step_id: string | null;
  region_cell_id: string | null;
  provider: CostProvider;
  item: string;
  units: number;
  unit_price_usd: number;
  amount_usd: number;
  kind: CostKind;
  corrects_id: string | null;
  reconciled_at: Date | null;
  created_at: Date;
}

const toEntry = (r: Row): CostEntry => ({
  id: r.id,
  runId: r.run_id,
  runStepId: r.run_step_id,
  regionCellId: r.region_cell_id,
  provider: r.provider,
  item: r.item,
  units: r.units,
  unitPriceUsd: r.unit_price_usd,
  amountUsd: r.amount_usd,
  kind: r.kind,
  correctsId: r.corrects_id,
  reconciledAt: r.reconciled_at,
  createdAt: r.created_at,
});

/** First day of the UTC month containing `at`. */
export function monthOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

async function sumRun(db: Queryable, runId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    'SELECT COALESCE(sum(amount_usd), 0) AS total FROM cost_ledger WHERE run_id = $1',
    [runId],
  );
  return rows[0]!.total;
}

export async function monthSpend(db: Queryable, userId: UserId, month: Date): Promise<number> {
  const start = monthOf(month);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const { rows } = await db.query<{ total: number }>(
    `SELECT COALESCE(sum(amount_usd), 0) AS total FROM cost_ledger
      WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
    [userId, start, end],
  );
  return rows[0]!.total;
}

async function monthCap(db: Queryable, userId: UserId, month: Date): Promise<number | null> {
  const { rows } = await db.query<{ cap_usd: number }>(
    'SELECT cap_usd FROM user_budget WHERE user_id = $1 AND month = $2',
    [userId, monthOf(month)],
  );
  return rows[0]?.cap_usd ?? null;
}

async function insertEntry(
  db: Queryable,
  userId: UserId,
  e: CostEntryInput & { correctsId?: string; reconciledAt?: Date },
): Promise<CostEntry> {
  const { rows } = await db.query<Row>(
    `INSERT INTO cost_ledger (user_id, run_id, run_step_id, region_cell_id, provider, item, units,
       unit_price_usd, amount_usd, kind, corrects_id, reconciled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, round($7::numeric * $8::numeric, 6), $9, $10, $11)
     RETURNING *`,
    [
      userId,
      e.runId,
      e.runStepId ?? null,
      e.regionCellId ?? null,
      e.provider,
      e.item,
      e.units,
      e.unitPriceUsd,
      e.kind,
      e.correctsId ?? null,
      e.reconciledAt ?? null,
    ],
  );
  return toEntry(rows[0]!);
}

/**
 * After a write: recomputes run and month totals from the ledger and, if either cap is
 * reached, stops the run (status 'stopped_by_cap'). Must run inside the write's transaction,
 * with the run row locked.
 */
async function settle(
  tx: Queryable,
  userId: UserId,
  run: { id: string; budget_cap_usd: number; status: string },
  entry: CostEntry,
): Promise<CostRecorded> {
  const runSpentUsd = await sumRun(tx, run.id);
  const monthSpentUsd = await monthSpend(tx, userId, entry.createdAt);
  const monthCapUsd = await monthCap(tx, userId, entry.createdAt);
  const overCap =
    runSpentUsd >= run.budget_cap_usd || (monthCapUsd !== null && monthSpentUsd >= monthCapUsd);
  let stoppedByCap = false;
  if (overCap && (run.status === 'pending' || run.status === 'running')) {
    await tx.query(
      `UPDATE runs SET status = 'stopped_by_cap', finished_at = now() WHERE user_id = $1 AND id = $2`,
      [userId, run.id],
    );
    stoppedByCap = true;
  }
  return {
    entry,
    runSpentUsd,
    runBudgetCapUsd: run.budget_cap_usd,
    monthSpentUsd,
    monthCapUsd,
    stoppedByCap,
  };
}

async function lockRun(tx: Queryable, userId: UserId, runId: string) {
  const { rows } = await tx.query<{ id: string; budget_cap_usd: number; status: string }>(
    'SELECT id, budget_cap_usd, status FROM runs WHERE user_id = $1 AND id = $2 FOR UPDATE',
    [userId, runId],
  );
  if (!rows[0]) throw new CostError('Run not found for this user');
  return rows[0];
}

/**
 * Appends a cost and, in the same transaction, recomputes the run and month totals and stops
 * the run if a cap is reached. Costs already incurred are always recorded, even past a cap.
 */
export async function recordCost(
  db: Queryable,
  userId: UserId,
  input: CostEntryInput,
): Promise<CostRecorded> {
  if (!(input.units >= 0)) throw new CostError('units must be >= 0; use correctCost to reverse');
  return withTransaction(db, async (tx) => {
    const run = await lockRun(tx, userId, input.runId);
    if (input.runStepId) {
      const step = await tx.query('SELECT 1 FROM run_steps WHERE id = $1 AND run_id = $2', [
        input.runStepId,
        input.runId,
      ]);
      if (step.rowCount === 0) throw new CostError('Step does not belong to this run');
    }
    const entry = await insertEntry(tx, userId, input);
    return settle(tx, userId, run, entry);
  });
}

async function loadEntry(tx: Queryable, userId: UserId, entryId: string): Promise<Row> {
  const { rows } = await tx.query<Row>('SELECT * FROM cost_ledger WHERE user_id = $1 AND id = $2', [
    userId,
    entryId,
  ]);
  const r = rows[0];
  if (!r) throw new CostError('Ledger entry not found for this user');
  if (r.corrects_id) throw new CostError('A correction cannot itself be corrected');
  const done = await tx.query('SELECT 1 FROM cost_ledger WHERE corrects_id = $1', [entryId]);
  if (done.rowCount) throw new CostError('Ledger entry was already corrected');
  return r;
}

/** Reverses an entry with a new row of the opposite amount. Each entry can be reversed once. */
export async function correctCost(
  db: Queryable,
  userId: UserId,
  entryId: string,
): Promise<CostRecorded> {
  return withTransaction(db, async (tx) => {
    const original = await loadEntry(tx, userId, entryId);
    const run = await lockRun(tx, userId, original.run_id);
    const entry = await insertEntry(tx, userId, {
      runId: original.run_id,
      runStepId: original.run_step_id,
      regionCellId: original.region_cell_id,
      provider: original.provider,
      item: original.item,
      units: -original.units,
      unitPriceUsd: original.unit_price_usd,
      kind: original.kind,
      correctsId: original.id,
    });
    return settle(tx, userId, run, entry);
  });
}

/**
 * Replaces an estimate with the provider's actual figure: reverses the estimate and appends
 * an 'actual' row stamped with reconciled_at, in one transaction.
 */
export async function reconcileCost(
  db: Queryable,
  userId: UserId,
  estimateId: string,
  actual: { units: number; unitPriceUsd: number },
): Promise<CostRecorded> {
  return withTransaction(db, async (tx) => {
    const estimate = await loadEntry(tx, userId, estimateId);
    if (estimate.kind !== 'estimated') throw new CostError('Only an estimate can be reconciled');
    await correctCost(tx, userId, estimateId);
    const run = await lockRun(tx, userId, estimate.run_id);
    const entry = await insertEntry(tx, userId, {
      runId: estimate.run_id,
      runStepId: estimate.run_step_id,
      regionCellId: estimate.region_cell_id,
      provider: estimate.provider,
      item: estimate.item,
      units: actual.units,
      unitPriceUsd: actual.unitPriceUsd,
      kind: 'actual',
      reconciledAt: new Date(),
    });
    return settle(tx, userId, run, entry);
  });
}

export async function listLedgerForRun(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<CostEntry[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM cost_ledger WHERE user_id = $1 AND run_id = $2 ORDER BY id',
    [userId, runId],
  );
  return rows.map(toEntry);
}

/**
 * What a run may still spend before a cap stops it: the smaller of its own remaining budget
 * and the month's (when a monthly cap is set). Pass this to Apify as the run's max cost.
 */
export async function remainingBudget(
  db: Queryable,
  userId: UserId,
  runId: string,
  now: Date = new Date(),
): Promise<number> {
  const { rows } = await db.query<{ budget_cap_usd: number }>(
    'SELECT budget_cap_usd FROM runs WHERE user_id = $1 AND id = $2',
    [userId, runId],
  );
  if (!rows[0]) throw new CostError('Run not found for this user');
  const runLeft = rows[0].budget_cap_usd - (await sumRun(db, runId));
  const cap = await monthCap(db, userId, now);
  const monthLeft = cap === null ? Infinity : cap - (await monthSpend(db, userId, now));
  return Math.max(0, Math.min(runLeft, monthLeft));
}

export interface CostPerLead {
  spentUsd: number;
  leads: number;
  /** null when there are no leads yet */
  costPerLeadUsd: number | null;
}

const perLead = (spentUsd: number, leads: number): CostPerLead => ({
  spentUsd,
  leads,
  costPerLeadUsd: leads > 0 ? spentUsd / leads : null,
});

/** All spend of the run over the leads it produced. */
export async function costPerLeadForRun(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<CostPerLead> {
  const { rows } = await db.query<{ spent: number; leads: number }>(
    `SELECT COALESCE((SELECT sum(amount_usd) FROM cost_ledger WHERE user_id = $1 AND run_id = $2), 0) AS spent,
            (SELECT count(*)::integer FROM crm_leads WHERE user_id = $1 AND run_id = $2) AS leads`,
    [userId, runId],
  );
  return perLead(rows[0]!.spent, rows[0]!.leads);
}

/** All spend of the user's runs in a region over the leads those runs produced. */
export async function costPerLeadForRegion(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<CostPerLead> {
  const { rows } = await db.query<{ spent: number; leads: number }>(
    `SELECT COALESCE((SELECT sum(l.amount_usd) FROM cost_ledger l JOIN runs r ON r.id = l.run_id
                       WHERE l.user_id = $1 AND r.region_id = $2), 0) AS spent,
            (SELECT count(*)::integer FROM crm_leads c JOIN runs r ON r.id = c.run_id
              WHERE c.user_id = $1 AND r.region_id = $2) AS leads`,
    [userId, regionId],
  );
  return perLead(rows[0]!.spent, rows[0]!.leads);
}

/**
 * Spend tagged with the cell over leads whose company was found in the cell. Only spend
 * recorded with a regionCellId counts, so the runner should tag per-company costs too.
 */
export async function costPerLeadForCell(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
): Promise<CostPerLead> {
  const { rows } = await db.query<{ spent: number; leads: number }>(
    `SELECT COALESCE((SELECT sum(amount_usd) FROM cost_ledger
                       WHERE user_id = $1 AND region_cell_id = $2), 0) AS spent,
            (SELECT count(*)::integer FROM crm_leads c JOIN companies co ON co.id = c.company_id
              WHERE c.user_id = $1 AND co.region_cell_id = $2) AS leads`,
    [userId, regionCellId],
  );
  return perLead(rows[0]!.spent, rows[0]!.leads);
}
