import type { CrmStage, ScoreBreakdown } from '@lead-gen-crm/shared';
import type { UserId } from './ids.js';
import { addSuppression, type SuppressionKind } from './suppressionList.js';
import { withTransaction, type Queryable } from './db.js';

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
    /** The run producing the lead. Kept from the first run when a later run finds it again. */
    runId: string;
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

/**
 * Moves a lead to a stage. Returns null if the lead isn't this user's, or if it is Opted out:
 * an objection is final and can't be undone from the CRM.
 */
export async function moveLead(
  db: Queryable,
  userId: UserId,
  leadId: string,
  stage: CrmStage,
): Promise<CrmLead | null> {
  const { rows } = await db.query<Row>(
    `UPDATE crm_leads SET stage = $3, stage_changed_at = now(), updated_at = now()
      WHERE user_id = $1 AND id = $2 AND (stage <> 'opted_out' OR $3 = 'opted_out') RETURNING *`,
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

/**
 * Records a person's objection: adds every identifier we hold for the lead (the contact's
 * email, phone and LinkedIn ID; the company's email and phone for a company-only lead) to the
 * suppression list, which every future write checks, and moves the lead to Opted out.
 * One transaction. Returns null if the lead isn't this user's.
 */
export async function recordObjection(
  db: Queryable,
  userId: UserId,
  leadId: string,
  reason: string,
): Promise<{ lead: CrmLead; suppressed: SuppressionKind[] } | null> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{
      contact_email: string | null;
      contact_phone: string | null;
      linkedin_id: string | null;
      company_email: string | null;
      company_phone: string | null;
      has_contact: boolean;
    }>(
      `SELECT p.email AS contact_email, p.phone AS contact_phone, p.linkedin_public_id AS linkedin_id,
              c.email AS company_email, c.phone AS company_phone, (l.contact_id IS NOT NULL) AS has_contact
         FROM crm_leads l JOIN companies c ON c.id = l.company_id
         LEFT JOIN contacts p ON p.id = l.contact_id
        WHERE l.user_id = $1 AND l.id = $2 FOR UPDATE OF l`,
      [userId, leadId],
    );
    const r = rows[0];
    if (!r) return null;
    const ids: { kind: SuppressionKind; value: string | null }[] = r.has_contact
      ? [
          { kind: 'email', value: r.contact_email },
          { kind: 'phone', value: r.contact_phone },
          { kind: 'linkedin', value: r.linkedin_id },
        ]
      : [
          { kind: 'email', value: r.company_email },
          { kind: 'phone', value: r.company_phone },
        ];
    const suppressed: SuppressionKind[] = [];
    for (const { kind, value } of ids) {
      if (!value) continue;
      await addSuppression(tx, userId, { kind, value, reason });
      suppressed.push(kind);
    }
    const lead = await moveLead(tx, userId, leadId, 'opted_out');
    return lead ? { lead, suppressed } : null;
  });
}
