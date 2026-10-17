import type { Evidence } from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';
import { assertSourced, type Sourced } from './sourced.js';

export type EvidenceTarget = { companyId: string } | { contactId: string };

/** Called by companies.ts and contacts.ts inside their write transaction. */
export async function insertEvidence(
  db: Queryable,
  userId: UserId,
  target: EvidenceTarget,
  field: string,
  s: Sourced<unknown>,
  runId: string | null,
): Promise<void> {
  assertSourced(field, s);
  await db.query(
    `INSERT INTO evidence (user_id, company_id, contact_id, run_id, field, value, source_url, fetched_at, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      'companyId' in target ? target.companyId : null,
      'contactId' in target ? target.contactId : null,
      runId,
      field,
      String(s.value),
      s.sourceUrl,
      s.fetchedAt,
      s.kind,
    ],
  );
}

/** Every value ever recorded for the target, newest first. */
export async function listEvidence(
  db: Queryable,
  userId: UserId,
  target: EvidenceTarget,
): Promise<Evidence[]> {
  const [col, id] =
    'companyId' in target ? ['company_id', target.companyId] : ['contact_id', target.contactId];
  const { rows } = await db.query<{
    field: string;
    value: string;
    source_url: string;
    fetched_at: Date;
    kind: Evidence['kind'];
  }>(
    `SELECT field, value, source_url, fetched_at, kind FROM evidence
      WHERE user_id = $1 AND ${col} = $2 ORDER BY fetched_at DESC, id DESC`,
    [userId, id],
  );
  return rows.map((r) => ({
    field: r.field,
    value: r.value,
    sourceUrl: r.source_url,
    fetchedAt: r.fetched_at.toISOString(),
    kind: r.kind,
  }));
}
