import type { CrmStage, ScoreBreakdown } from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export interface CrmLead {
  id: string;
  runId: string | null;
  companyId: string;
  contactId: string | null;
  stage: CrmStage;
  score: ScoreBreakdown;
  stageChangedAt: Date;
  createdAt: Date;
}

interface Row {
  id: string;
  run_id: string | null;
  company_id: string;
  contact_id: string | null;
  stage: CrmStage;
  score_company_fit: number;
  score_contact_fit: number;
  score_reachability: number;
  score_total: number;
  stage_changed_at: Date;
  created_at: Date;
}

const toLead = (r: Row): CrmLead => ({
  id: r.id,
  runId: r.run_id,
  companyId: r.company_id,
  contactId: r.contact_id,
  stage: r.stage,
  score: {
    companyFit: r.score_company_fit,
    contactFit: r.score_contact_fit,
    reachability: r.score_reachability,
    total: r.score_total,
  },
  stageChangedAt: r.stage_changed_at,
  createdAt: r.created_at,
});

/**
 * Creates a lead in 'system_suggested', or refreshes the score of an existing one for the
 * same company/contact. The stage of an existing lead is never touched, so a dismissed or
 * opted-out lead does not come back. Returns null if the company or contact isn't this user's.
 */
export async function upsertLead(
  db: Queryable,
  userId: UserId,
  input: {
    runId: string | null;
    companyId: string;
    contactId: string | null;
    score: Omit<ScoreBreakdown, 'total'>;
  },
): Promise<{ lead: CrmLead; created: boolean } | null> {
  const { rows } = await db.query<Row & { created: boolean }>(
    `INSERT INTO crm_leads (user_id, run_id, company_id, contact_id,
                            score_company_fit, score_contact_fit, score_reachability)
     SELECT $1, $2, c.id, $4, $5, $6, $7 FROM companies c
      WHERE c.user_id = $1 AND c.id = $3
        AND ($4::uuid IS NULL OR EXISTS
              (SELECT 1 FROM contacts p WHERE p.user_id = $1 AND p.id = $4 AND p.company_id = c.id))
     ON CONFLICT (user_id, company_id, contact_id) DO UPDATE SET
       score_company_fit = EXCLUDED.score_company_fit,
       score_contact_fit = EXCLUDED.score_contact_fit,
       score_reachability = EXCLUDED.score_reachability,
       updated_at = now()
     RETURNING *, (xmax = 0) AS created`,
    [
      userId,
      input.runId,
      input.companyId,
      input.contactId,
      input.score.companyFit,
      input.score.contactFit,
      input.score.reachability,
    ],
  );
  const r = rows[0];
  return r ? { lead: toLead(r), created: r.created } : null;
}

export async function moveLead(
  db: Queryable,
  userId: UserId,
  leadId: string,
  stage: CrmStage,
): Promise<CrmLead | null> {
  const { rows } = await db.query<Row>(
    `UPDATE crm_leads SET stage = $3, stage_changed_at = now(), updated_at = now()
      WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, leadId, stage],
  );
  return rows[0] ? toLead(rows[0]) : null;
}

export async function getLead(
  db: Queryable,
  userId: UserId,
  leadId: string,
): Promise<CrmLead | null> {
  const { rows } = await db.query<Row>('SELECT * FROM crm_leads WHERE user_id = $1 AND id = $2', [
    userId,
    leadId,
  ]);
  return rows[0] ? toLead(rows[0]) : null;
}

export async function listLeads(
  db: Queryable,
  userId: UserId,
  filter: { stage?: CrmStage; runId?: string } = {},
): Promise<CrmLead[]> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM crm_leads
      WHERE user_id = $1 AND ($2::text IS NULL OR stage = $2) AND ($3::uuid IS NULL OR run_id = $3)
      ORDER BY score_total DESC, created_at`,
    [userId, filter.stage ?? null, filter.runId ?? null],
  );
  return rows.map(toLead);
}
