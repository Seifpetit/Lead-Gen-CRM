import { monthOf, monthSpend } from './costLedger.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export interface MonthlyBudget {
  /** First day of the UTC month. */
  month: Date;
  capUsd: number | null;
  /** Summed from the cost ledger. */
  spentUsd: number;
}

/** Sets the user's spending cap for the month containing `month`. */
export async function setMonthlyCap(
  db: Queryable,
  userId: UserId,
  month: Date,
  capUsd: number,
): Promise<MonthlyBudget> {
  await db.query(
    `INSERT INTO user_budget (user_id, month, cap_usd) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, month) DO UPDATE SET cap_usd = EXCLUDED.cap_usd, updated_at = now()`,
    [userId, monthOf(month), capUsd],
  );
  return getMonthlyBudget(db, userId, month);
}

export async function getMonthlyBudget(
  db: Queryable,
  userId: UserId,
  month: Date,
): Promise<MonthlyBudget> {
  const start = monthOf(month);
  const { rows } = await db.query<{ cap_usd: number }>(
    'SELECT cap_usd FROM user_budget WHERE user_id = $1 AND month = $2',
    [userId, start],
  );
  return {
    month: start,
    capUsd: rows[0]?.cap_usd ?? null,
    spentUsd: await monthSpend(db, userId, start),
  };
}
