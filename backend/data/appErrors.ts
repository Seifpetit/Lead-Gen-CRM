import { createHash } from 'node:crypto';
import type {
  AppErrorView,
  FailureKind,
  HealthProvider,
  HealthState,
  ProviderHealth,
} from '@lead-gen-crm/shared';
import { redactSecrets } from '../lib/redact.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// Failures worth remembering, and whether each provider answers. Everything is masked before it
// is written, so the table can be shown on the Health page and downloaded without a leak.

const MAX_MESSAGE_CHARS = 500;
const STACK_LINES = 5;
const MAX_STACK_CHARS = 800;

export interface ErrorInput {
  userId?: UserId | null;
  runId?: string | null;
  source: string;
  provider?: string | null;
  step?: string | null;
  kind: string;
  message: string;
  /** An Error's stack; only the top few lines are kept. */
  stack?: string | null | undefined;
  secrets?: readonly (string | null | undefined)[] | undefined;
}

/** The top lines of a stack, without absolute paths of this machine's folders. */
export function stackSummary(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const lines = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, STACK_LINES)
    .map((l) =>
      l.replace(/\(?(?:file:\/\/)?(?:[A-Za-z]:)?[^\s():]*[\\/]([^\\/\s():]+:\d+:\d+)\)?/, '($1)'),
    );
  return lines.length === 0 ? null : lines.join('\n').slice(0, MAX_STACK_CHARS);
}

/** What makes two failures "the same one coming back": numbers and ids in the text do not. */
export function fingerprintOf(input: {
  source: string;
  provider?: string | null | undefined;
  step?: string | null | undefined;
  kind: string;
  message: string;
}): string {
  const text = input.message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#')
    .replace(/\d+/g, '#')
    .slice(0, 200);
  return createHash('sha1')
    .update([input.source, input.provider ?? '', input.step ?? '', input.kind, text].join('|'))
    .digest('hex');
}

interface ErrorRow {
  id: string;
  run_id: string | null;
  source: string;
  provider: string | null;
  step: string | null;
  kind: string;
  message: string;
  stack: string | null;
  count: number;
  first_seen: Date;
  last_seen: Date;
}

/** Stores a failure, or counts one more of the same kind. Never throws: failing to note a failure must not cause another. */
export async function recordError(db: Queryable, input: ErrorInput): Promise<void> {
  try {
    const message = redactSecrets(input.message, input.secrets).slice(0, MAX_MESSAGE_CHARS);
    const stack = stackSummary(input.stack);
    const masked = stack === null ? null : redactSecrets(stack, input.secrets);
    const fingerprint = fingerprintOf({ ...input, message });
    await db.query(
      `INSERT INTO app_errors (user_id, run_id, source, provider, step, kind, message, stack, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (COALESCE(user_id::text, ''), fingerprint)
       DO UPDATE SET count = app_errors.count + 1, last_seen = now(),
                     run_id = COALESCE(EXCLUDED.run_id, app_errors.run_id),
                     message = EXCLUDED.message`,
      [
        input.userId ?? null,
        input.runId ?? null,
        input.source,
        input.provider ?? null,
        input.step ?? null,
        input.kind,
        message,
        masked,
        fingerprint,
      ],
    );
  } catch {
    // The table may not exist yet (a migration problem) or the database may be down.
  }
}

const toView = (r: ErrorRow): AppErrorView => ({
  id: r.id,
  source: r.source,
  provider: r.provider,
  step: r.step,
  runId: r.run_id,
  kind: r.kind,
  message: r.message,
  stack: r.stack,
  count: r.count,
  firstSeen: r.first_seen.toISOString(),
  lastSeen: r.last_seen.toISOString(),
});

/** The latest distinct errors, most recent first: this user's own and the ones that belong to no one. */
export async function listErrors(
  db: Queryable,
  userId: UserId,
  limit = 20,
): Promise<AppErrorView[]> {
  const { rows } = await db.query<ErrorRow>(
    `SELECT id, run_id, source, provider, step, kind, message, stack, count, first_seen, last_seen
       FROM app_errors WHERE user_id = $1 OR user_id IS NULL
      ORDER BY last_seen DESC, id LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toView);
}

// ---------------------------------------------------------------------------------------
// Provider health

interface HealthRow {
  provider: HealthProvider;
  state: HealthState;
  kind: FailureKind | null;
  reason: string | null;
  consecutive_failures: number;
  since: Date | null;
  last_ok_at: Date | null;
}

const toHealth = (r: HealthRow): ProviderHealth => ({
  provider: r.provider,
  state: r.state,
  reason: r.reason,
  kind: r.kind,
  since: r.since?.toISOString() ?? null,
  lastOkAt: r.last_ok_at?.toISOString() ?? null,
});

export async function getProviderHealth(
  db: Queryable,
  provider: HealthProvider,
): Promise<(ProviderHealth & { consecutiveFailures: number }) | null> {
  const { rows } = await db.query<HealthRow>(
    `SELECT provider, state, kind, reason, consecutive_failures, since, last_ok_at
       FROM provider_health WHERE provider = $1`,
    [provider],
  );
  const r = rows[0];
  return r ? { ...toHealth(r), consecutiveFailures: r.consecutive_failures } : null;
}

export async function listProviderHealth(db: Queryable): Promise<ProviderHealth[]> {
  const { rows } = await db.query<HealthRow>(
    `SELECT provider, state, kind, reason, consecutive_failures, since, last_ok_at
       FROM provider_health ORDER BY provider`,
  );
  return rows.map(toHealth);
}

/** A call went through: the provider is ok again. */
export async function markProviderOk(db: Queryable, provider: HealthProvider): Promise<void> {
  await db.query(
    `INSERT INTO provider_health (provider, state, last_ok_at)
     VALUES ($1, 'ok', now())
     ON CONFLICT (provider) DO UPDATE
       SET state = 'ok', kind = NULL, reason = NULL, consecutive_failures = 0,
           since = NULL, last_ok_at = now(), updated_at = now()`,
    [provider],
  );
}

/** A call failed: counts it and sets the state. `since` keeps the first moment it left ok. */
export async function markProviderFailed(
  db: Queryable,
  provider: HealthProvider,
  failure: { kind: FailureKind; reason: string },
  decide: (consecutiveFailures: number) => 'degraded' | 'down',
): Promise<ProviderHealth> {
  const before = await getProviderHealth(db, provider);
  const failures = (before?.consecutiveFailures ?? 0) + 1;
  const state = decide(failures);
  const { rows } = await db.query<HealthRow>(
    `INSERT INTO provider_health (provider, state, kind, reason, consecutive_failures, since)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider) DO UPDATE
       SET state = $2, kind = $3, reason = $4, consecutive_failures = $5,
           since = COALESCE(CASE WHEN provider_health.state = 'ok' THEN NULL ELSE provider_health.since END, now()),
           updated_at = now()
     RETURNING provider, state, kind, reason, consecutive_failures, since, last_ok_at`,
    [provider, state, failure.kind, failure.reason, failures],
  );
  return toHealth(rows[0]!);
}
