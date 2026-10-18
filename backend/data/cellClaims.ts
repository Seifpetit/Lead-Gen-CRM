import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// A run claims the cells it searches; no other run of the same user can claim them until the
// claim is released or expires. The runner renews claims while the run is alive, so a run
// that dies releases its cells after one TTL.

/**
 * Claims each cell that is free, expired, or already this run's. Atomic per cell: of two runs
 * claiming the same cell at the same moment, exactly one gets it. Returns the cells claimed.
 */
export async function claimCells(
  db: Queryable,
  userId: UserId,
  runId: string,
  cellIds: readonly string[],
  ttlMs: number,
): Promise<string[]> {
  if (cellIds.length === 0) return [];
  const { rows } = await db.query<{ region_cell_id: string }>(
    `INSERT INTO cell_claims AS c (user_id, region_cell_id, run_id, expires_at)
     SELECT $1, cell, r.id, now() + make_interval(secs => $4::double precision / 1000)
       FROM unnest($3::uuid[]) AS cell, runs r WHERE r.user_id = $1 AND r.id = $2
     ON CONFLICT (user_id, region_cell_id) DO UPDATE
        SET run_id = EXCLUDED.run_id, claimed_at = now(), expires_at = EXCLUDED.expires_at
      WHERE c.expires_at < now() OR c.run_id = EXCLUDED.run_id
     RETURNING region_cell_id`,
    [userId, runId, cellIds, ttlMs],
  );
  return rows.map((r) => r.region_cell_id).sort();
}

/** Extends the run's live claims. Returns the cells it still holds. */
export async function renewClaims(
  db: Queryable,
  userId: UserId,
  runId: string,
  ttlMs: number,
): Promise<string[]> {
  const { rows } = await db.query<{ region_cell_id: string }>(
    `UPDATE cell_claims SET expires_at = now() + make_interval(secs => $3::double precision / 1000)
      WHERE user_id = $1 AND run_id = $2 AND expires_at >= now() RETURNING region_cell_id`,
    [userId, runId, ttlMs],
  );
  return rows.map((r) => r.region_cell_id).sort();
}

export async function releaseClaims(db: Queryable, userId: UserId, runId: string): Promise<void> {
  await db.query('DELETE FROM cell_claims WHERE user_id = $1 AND run_id = $2', [userId, runId]);
}

/** Cells held right now (unexpired) by any of the user's runs, with the holder. */
export async function listLiveClaims(
  db: Queryable,
  userId: UserId,
): Promise<{ regionCellId: string; runId: string; expiresAt: Date }[]> {
  const { rows } = await db.query<{ region_cell_id: string; run_id: string; expires_at: Date }>(
    `SELECT region_cell_id, run_id, expires_at FROM cell_claims
      WHERE user_id = $1 AND expires_at >= now() ORDER BY region_cell_id`,
    [userId],
  );
  return rows.map((r) => ({
    regionCellId: r.region_cell_id,
    runId: r.run_id,
    expiresAt: r.expires_at,
  }));
}

/** Test helper and admin tool: force the run's claims to lapse, as if the run died. */
export async function expireClaims(db: Queryable, userId: UserId, runId: string): Promise<void> {
  await db.query(
    `UPDATE cell_claims SET expires_at = now() - interval '1 second'
      WHERE user_id = $1 AND run_id = $2`,
    [userId, runId],
  );
}
