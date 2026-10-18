import type { Queryable } from './db.js';
import { trustedUserId, type UserId } from './ids.js';

export interface Session {
  userId: UserId;
  email: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export async function createSession(
  db: Queryable,
  userId: UserId,
  input: { tokenHash: string; now: Date; expiresAt: Date },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $3, $4)`,
    [input.tokenHash, userId, input.now, input.expiresAt],
  );
}

/**
 * Resolves a session token hash to its user, or null when unknown, past its absolute expiry,
 * or idle since before idleCutoff. Refreshes last_seen_at on success. This is how a request
 * obtains a UserId in the first place, so it is the one lookup that does not start from one.
 */
export async function touchSession(
  db: Queryable,
  tokenHash: string,
  now: Date,
  idleCutoff: Date,
): Promise<Session | null> {
  const { rows } = await db.query<{
    user_id: string;
    email: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
  }>(
    `UPDATE sessions s SET last_seen_at = $2
       FROM users u
      WHERE s.token_hash = $1 AND u.id = s.user_id AND s.expires_at > $2 AND s.last_seen_at > $3
     RETURNING s.user_id, u.email, s.created_at, s.last_seen_at, s.expires_at`,
    [tokenHash, now, idleCutoff],
  );
  const r = rows[0];
  return r
    ? {
        userId: trustedUserId(r.user_id),
        email: r.email,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
      }
    : null;
}

export async function deleteSession(db: Queryable, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteUserSessions(db: Queryable, userId: UserId): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function deleteExpiredSessions(
  db: Queryable,
  now: Date,
  idleCutoff: Date,
): Promise<number> {
  const { rowCount } = await db.query(
    'DELETE FROM sessions WHERE expires_at <= $1 OR last_seen_at <= $2',
    [now, idleCutoff],
  );
  return rowCount ?? 0;
}
