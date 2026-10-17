import type { Queryable } from './db.js';

// Not user-owned: failures are recorded before (and whether or not) a user is identified.

export async function recordLoginFailure(
  db: Queryable,
  input: { email: string; ip: string; at: Date },
): Promise<void> {
  await db.query('INSERT INTO login_failures (email, ip, failed_at) VALUES ($1, $2, $3)', [
    input.email.trim().toLowerCase(),
    input.ip,
    input.at,
  ]);
}

/** Failures for an email and for an IP since `since`, plus the latest failure for the email. */
export async function countLoginFailures(
  db: Queryable,
  input: { email: string; ip: string; since: Date },
): Promise<{ byEmail: number; byIp: number; lastEmailFailure: Date | null }> {
  const { rows } = await db.query<{ by_email: string; by_ip: string; last_email: Date | null }>(
    `SELECT count(*) FILTER (WHERE email = $1) AS by_email,
            count(*) FILTER (WHERE ip = $2) AS by_ip,
            max(failed_at) FILTER (WHERE email = $1) AS last_email
       FROM login_failures WHERE failed_at > $3 AND (email = $1 OR ip = $2)`,
    [input.email.trim().toLowerCase(), input.ip, input.since],
  );
  const r = rows[0]!;
  return { byEmail: Number(r.by_email), byIp: Number(r.by_ip), lastEmailFailure: r.last_email };
}

export async function clearLoginFailures(db: Queryable, email: string): Promise<void> {
  await db.query('DELETE FROM login_failures WHERE email = $1', [email.trim().toLowerCase()]);
}

export async function deleteLoginFailuresBefore(db: Queryable, before: Date): Promise<void> {
  await db.query('DELETE FROM login_failures WHERE failed_at < $1', [before]);
}
