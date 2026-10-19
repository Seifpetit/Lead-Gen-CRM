import type { LogLevel, RunLogLine, RunLogPage } from '@lead-gen-crm/shared';
import { redactSecrets } from '../lib/redact.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// A run's log: the sentences shown live and the technical detail behind them. Every line is
// redacted on the way in, so a credential in a provider's error message is never stored.

interface Row {
  id: string;
  occurred_at: Date;
  level: LogLevel;
  technical: boolean;
  message: string;
}

const toLine = (r: Row): RunLogLine => ({
  id: Number(r.id),
  at: r.occurred_at.toISOString(),
  level: r.level,
  message: r.message,
  technical: r.technical,
});

/** Longest line stored; a provider can return a whole page of HTML as its error. */
const MAX_MESSAGE_CHARS = 2000;

export async function appendRunLog(
  db: Queryable,
  userId: UserId,
  input: {
    runId: string;
    runStepId?: string | null;
    level?: LogLevel;
    technical?: boolean;
    message: string;
    /** Values this process holds that must never be stored, such as API tokens. */
    secrets?: readonly (string | null | undefined)[] | undefined;
  },
): Promise<void> {
  const message = redactSecrets(input.message, input.secrets).slice(0, MAX_MESSAGE_CHARS);
  await db.query(
    `INSERT INTO run_log (user_id, run_id, run_step_id, level, technical, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      input.runId,
      input.runStepId ?? null,
      input.level ?? 'info',
      input.technical ?? false,
      message,
    ],
  );
}

/** Sets the sentence a run shows right now (already redacted by the caller's `say`). */
export async function setLiveMessage(
  db: Queryable,
  userId: UserId,
  runId: string,
  message: string,
): Promise<void> {
  await db.query('UPDATE runs SET live_message = $3 WHERE user_id = $1 AND id = $2', [
    userId,
    runId,
    message,
  ]);
}

/** Lines of one run, oldest first, after the given id. Re-redacted on the way out. */
export async function listRunLog(
  db: Queryable,
  userId: UserId,
  runId: string,
  opts: {
    after?: number;
    limit: number;
    secrets?: readonly (string | null | undefined)[] | undefined;
  },
): Promise<RunLogPage> {
  const { rows } = await db.query<Row>(
    `SELECT id, occurred_at, level, technical, message FROM run_log
      WHERE user_id = $1 AND run_id = $2 AND id > $3
      ORDER BY id LIMIT $4`,
    [userId, runId, opts.after ?? 0, opts.limit + 1],
  );
  const items = rows.slice(0, opts.limit).map((r) => {
    const line = toLine(r);
    return { ...line, message: redactSecrets(line.message, opts.secrets) };
  });
  return { items, hasMore: rows.length > opts.limit };
}

/** A technical line about one step; the run comes from the step. Same redaction as appendRunLog. */
export async function appendStepLog(
  db: Queryable,
  userId: UserId,
  input: {
    runStepId: string;
    level?: LogLevel;
    message: string;
    secrets?: readonly (string | null | undefined)[] | undefined;
  },
): Promise<void> {
  const message = redactSecrets(input.message, input.secrets).slice(0, MAX_MESSAGE_CHARS);
  // The step's own name and provider run are appended, so a technical line says where it came from.
  await db.query(
    `INSERT INTO run_log (user_id, run_id, run_step_id, level, technical, message)
     SELECT $1, s.run_id, s.id, $3, true,
            $4 || ' [' || s.stage || ' step' || COALESCE(', run ' || s.apify_run_id, '') || ']'
       FROM run_steps s WHERE s.user_id = $1 AND s.id = $2`,
    [userId, input.runStepId, input.level ?? 'info', message],
  );
}
