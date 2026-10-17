import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export async function createInvite(
  db: Queryable,
  input: { codeHash: string; expiresAt: Date },
): Promise<void> {
  await db.query('INSERT INTO invites (code_hash, expires_at) VALUES ($1, $2)', [
    input.codeHash,
    input.expiresAt,
  ]);
}

/**
 * Marks an unused, unexpired invite as used. Returns false if there is no such invite.
 * Atomic, so two sign-ups racing on one code cannot both succeed.
 */
export async function consumeInvite(db: Queryable, codeHash: string, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE invites SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2`,
    [codeHash, now],
  );
  return rowCount === 1;
}

export async function markInviteUsedBy(
  db: Queryable,
  codeHash: string,
  userId: UserId,
): Promise<void> {
  await db.query('UPDATE invites SET used_by = $2 WHERE code_hash = $1', [codeHash, userId]);
}
