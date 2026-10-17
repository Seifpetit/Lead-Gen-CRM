import type { Queryable } from './db.js';
import type { UserId } from './ids.js';
import { normalizeEmail, normalizeLinkedinId, phoneKey } from './normalize.js';

/**
 * People who objected to being contacted. Global on purpose: an objection applies to every
 * user, so lookups do not filter by user. Recording one still requires the acting user.
 */
export type SuppressionKind = 'email' | 'phone' | 'linkedin';

export interface ContactIdentifiers {
  email?: string | null;
  phone?: string | null;
  linkedinPublicId?: string | null;
}

export class SuppressedContactError extends Error {
  constructor(public readonly kinds: SuppressionKind[]) {
    super(`Contact is on the suppression list (${kinds.join(', ')}); not stored`);
    this.name = 'SuppressedContactError';
  }
}

function suppressionKey(kind: SuppressionKind, value: string): string {
  if (kind === 'email') return normalizeEmail(value);
  if (kind === 'phone') return phoneKey(value);
  return normalizeLinkedinId(value);
}

export async function addSuppression(
  db: Queryable,
  recordedBy: UserId,
  entry: { kind: SuppressionKind; value: string; reason: string },
): Promise<void> {
  await db.query(
    `INSERT INTO suppression_list (kind, value, reason, recorded_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, value) DO NOTHING`,
    [entry.kind, suppressionKey(entry.kind, entry.value), entry.reason, recordedBy],
  );
}

/** Returns which of the given identifiers are suppressed (empty when none). */
export async function findSuppressed(
  db: Queryable,
  ids: ContactIdentifiers,
): Promise<SuppressionKind[]> {
  const pairs: [SuppressionKind, string][] = [];
  if (ids.email) pairs.push(['email', suppressionKey('email', ids.email)]);
  if (ids.phone) pairs.push(['phone', suppressionKey('phone', ids.phone)]);
  if (ids.linkedinPublicId)
    pairs.push(['linkedin', suppressionKey('linkedin', ids.linkedinPublicId)]);
  if (pairs.length === 0) return [];
  const { rows } = await db.query<{ kind: SuppressionKind }>(
    `SELECT DISTINCT s.kind FROM suppression_list s
       JOIN unnest($1::text[], $2::text[]) AS q(kind, value) ON s.kind = q.kind AND s.value = q.value`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  return rows.map((r) => r.kind).sort();
}

export async function assertNotSuppressed(db: Queryable, ids: ContactIdentifiers): Promise<void> {
  const kinds = await findSuppressed(db, ids);
  if (kinds.length > 0) throw new SuppressedContactError(kinds);
}
