import type {
  ApifyEventView,
  ApifyStepView,
  Company,
  Contact,
  CostGroupBy,
  CostRow,
  CrmStage,
  Lead,
  LeadFilter,
  LedgerEntryView,
  RunFunnel,
  RunStage,
  RunStepCounts,
  RunSummary,
  ScoreReason,
} from '@lead-gen-crm/shared';
import { RUN_STAGES } from '@lead-gen-crm/shared';
import { getCompany } from './companies.js';
import { getContact } from './contacts.js';
import type { Queryable } from './db.js';
import { listEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import { getRun } from './runs.js';

// Read models for the HTTP API: paginated lists and joined views. Every query is scoped to
// the user. Writes stay in the entity modules.

export interface PageQuery {
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------------------
// Runs

const EMPTY_FUNNEL: RunFunnel = {
  discovered: 0,
  skipped: 0,
  qualified: 0,
  rejected: 0,
  review: 0,
  unreachable: 0,
  peopleFound: 0,
  enriched: 0,
  scored: 0,
  leads: 0,
};

/**
 * Companies per funnel state, cumulative: a company counts as discovered, qualified and so on
 * once it has passed that point, so the funnel reads top to bottom.
 */
async function funnels(db: Queryable, userId: UserId, runIds: string[]) {
  const out = new Map<string, RunFunnel>(runIds.map((id) => [id, { ...EMPTY_FUNNEL }]));
  if (runIds.length === 0) return out;
  const { rows } = await db.query<{ run_id: string; state: string; is_new: boolean; n: number }>(
    `SELECT run_id, state, is_new, count(*)::integer AS n FROM run_companies
      WHERE user_id = $1 AND run_id = ANY($2::uuid[]) GROUP BY 1, 2, 3`,
    [userId, runIds],
  );
  const past: Record<string, (keyof RunFunnel)[]> = {
    discovered: ['discovered'],
    qualified: ['discovered', 'qualified'],
    rejected: ['discovered', 'rejected'],
    review: ['discovered', 'review'],
    unreachable: ['discovered', 'qualified', 'unreachable'],
    people_found: ['discovered', 'qualified', 'peopleFound'],
    enriched: ['discovered', 'qualified', 'peopleFound', 'enriched'],
    verified: ['discovered', 'qualified', 'peopleFound', 'enriched'],
    scored: ['discovered', 'qualified', 'peopleFound', 'enriched', 'scored'],
  };
  for (const r of rows) {
    const f = out.get(r.run_id)!;
    if (r.state === 'skipped') {
      f.skipped += r.n;
      continue;
    }
    // Maintenance re-checks start at 'qualified' without being discovered by this run.
    for (const k of past[r.state] ?? []) {
      if (k === 'discovered' && !r.is_new) continue;
      f[k] += r.n;
    }
  }
  const leads = await db.query<{ run_id: string; n: number }>(
    `SELECT run_id, count(*)::integer AS n FROM crm_leads
      WHERE user_id = $1 AND run_id = ANY($2::uuid[]) GROUP BY 1`,
    [userId, runIds],
  );
  for (const r of leads.rows) out.get(r.run_id)!.leads = r.n;
  return out;
}

export async function listRunSummaries(
  db: Queryable,
  userId: UserId,
  page: PageQuery,
  filter: { status?: string[] } = {},
): Promise<{ items: RunSummary[]; total: number }> {
  const status = filter.status && filter.status.length > 0 ? filter.status : null;
  const { rows } = await db.query<{ id: string; total: number }>(
    `SELECT id, count(*) OVER ()::integer AS total FROM runs
      WHERE user_id = $1 AND ($4::text[] IS NULL OR status = ANY($4))
      ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
    [userId, page.limit, page.offset, status],
  );
  const total =
    rows[0]?.total ??
    (
      await db.query<{ n: number }>(
        `SELECT count(*)::integer AS n FROM runs
          WHERE user_id = $1 AND ($2::text[] IS NULL OR status = ANY($2))`,
        [userId, status],
      )
    ).rows[0]!.n;
  return {
    items: await runSummaries(
      db,
      userId,
      rows.map((r) => r.id),
    ),
    total,
  };
}

export async function runSummaries(
  db: Queryable,
  userId: UserId,
  runIds: string[],
): Promise<RunSummary[]> {
  const f = await funnels(db, userId, runIds);
  const errors = await db.query<{ id: string; error: string | null }>(
    'SELECT id, error FROM runs WHERE user_id = $1 AND id = ANY($2::uuid[])',
    [userId, runIds],
  );
  const errorOf = new Map(errors.rows.map((r) => [r.id, r.error]));
  const out: RunSummary[] = [];
  for (const id of runIds) {
    const run = await getRun(db, userId, id);
    if (run) out.push({ ...run, funnel: f.get(id)!, error: errorOf.get(id) ?? null });
  }
  return out;
}

export async function runStepCounts(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<RunStepCounts[]> {
  const { rows } = await db.query<{ stage: RunStage; status: string; n: number }>(
    `SELECT stage, status, count(*)::integer AS n FROM run_steps
      WHERE user_id = $1 AND run_id = $2 GROUP BY 1, 2`,
    [userId, runId],
  );
  return RUN_STAGES.map((stage) => {
    const of = (...s: string[]) =>
      rows.filter((r) => r.stage === stage && s.includes(r.status)).reduce((a, r) => a + r.n, 0);
    return {
      stage,
      pending: of('pending'),
      inFlight: of('started', 'running'),
      finished: of('finished'),
      failed: of('failed'),
    };
  }).filter((c) => c.pending + c.inFlight + c.finished + c.failed > 0);
}

// ---------------------------------------------------------------------------------------
// Leads

export async function listLeadIds(
  db: Queryable,
  userId: UserId,
  filter: LeadFilter,
  page: PageQuery,
): Promise<{ ids: string[]; total: number }> {
  const { rows } = await db.query<{ id: string; total: number }>(
    `SELECT l.id, count(*) OVER ()::integer AS total
       FROM crm_leads l
       JOIN companies c ON c.id = l.company_id
       LEFT JOIN contacts p ON p.id = l.contact_id
      WHERE l.user_id = $1
        AND ($4::text[] IS NULL OR l.stage = ANY($4))
        AND ($5::uuid IS NULL OR l.run_id = $5)
        AND ($6::text IS NULL OR c.governorate = $6)
        AND ($7::int IS NULL OR l.score_total >= $7)
        AND ($8::text IS NULL OR c.name ILIKE $8 OR p.full_name ILIKE $8)
      ORDER BY l.score_total DESC, l.created_at, l.id
      LIMIT $2 OFFSET $3`,
    [
      userId,
      page.limit,
      page.offset,
      filter.stage && filter.stage.length > 0 ? filter.stage : null,
      filter.runId ?? null,
      filter.regionId ?? null,
      filter.minScore ?? null,
      filter.q ? `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null,
    ],
  );
  if (rows.length > 0 || page.offset === 0)
    return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0 };
  // Past the last page: report the total without rows.
  const all = await listLeadIds(db, userId, filter, { limit: 1, offset: 0 });
  return { ids: [], total: all.total };
}

/** Full leads with their company, contact and every piece of evidence, in the given order. */
export async function loadLeads(db: Queryable, userId: UserId, ids: string[]): Promise<Lead[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<{
    id: string;
    run_id: string | null;
    company_id: string;
    contact_id: string | null;
    stage: CrmStage;
    score_company_fit: number;
    score_contact_fit: number;
    score_reachability: number;
    score_total: number;
    score_reasons: ScoreReason[];
  }>('SELECT * FROM crm_leads WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Lead[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const company = await companyView(db, userId, r.company_id);
    if (!company) continue;
    out.push({
      id: r.id,
      runId: r.run_id ?? '',
      company,
      contact: r.contact_id ? await contactView(db, userId, r.contact_id) : null,
      score: {
        companyFit: r.score_company_fit,
        contactFit: r.score_contact_fit,
        reachability: r.score_reachability,
        total: r.score_total,
      },
      scoreReasons: r.score_reasons,
      crmStage: r.stage,
    });
  }
  return out;
}

async function companyView(db: Queryable, userId: UserId, id: string): Promise<Company | null> {
  const c = await getCompany(db, userId, id);
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    governorate: c.governorate,
    sector: c.sector,
    googlePlaceId: c.googlePlaceId,
    domain: c.domain,
    website: c.website,
    phone: c.phone,
    phoneE164: c.phoneE164,
    phoneForeign: c.phoneForeign,
    email: c.email,
    linkedinUrl: c.linkedinUrl,
    evidence: await listEvidence(db, userId, { companyId: id }),
  };
}

async function contactView(db: Queryable, userId: UserId, id: string): Promise<Contact | null> {
  const p = await getContact(db, userId, id);
  if (!p) return null;
  return {
    id: p.id,
    companyId: p.companyId,
    fullName: p.fullName,
    title: p.title ?? '',
    roleClass: p.roleClass,
    linkedinPublicId: p.linkedinPublicId,
    linkedinUrl: p.linkedinUrl,
    email: p.email,
    phone: p.phone,
    currentRoleVerified: p.currentRoleVerified,
    evidence: await listEvidence(db, userId, { contactId: id }),
  };
}

/**
 * What the user's dismissals say: how many leads were dismissed per company sector and per
 * contact role class. The scoring step lowers fit for the patterns the user keeps rejecting.
 */
export async function dismissalFeedback(
  db: Queryable,
  userId: UserId,
): Promise<{ bySector: Record<string, number>; byRoleClass: Record<string, number> }> {
  const { rows } = await db.query<{ sector: string | null; role_class: string | null; n: number }>(
    `SELECT c.sector, p.role_class, count(*)::integer AS n
       FROM crm_leads l JOIN companies c ON c.id = l.company_id
       LEFT JOIN contacts p ON p.id = l.contact_id
      WHERE l.user_id = $1 AND l.stage = 'dismissed' GROUP BY 1, 2`,
    [userId],
  );
  const bySector: Record<string, number> = {};
  const byRoleClass: Record<string, number> = {};
  for (const r of rows) {
    if (r.sector) bySector[r.sector] = (bySector[r.sector] ?? 0) + r.n;
    if (r.role_class) byRoleClass[r.role_class] = (byRoleClass[r.role_class] ?? 0) + r.n;
  }
  return { bySector, byRoleClass };
}

// ---------------------------------------------------------------------------------------
// Costs

const GROUP_KEY: Record<CostGroupBy, string> = {
  run: 'l.run_id::text',
  region: 'r.region_id',
  provider: 'l.provider',
  month: "to_char(date_trunc('month', l.created_at AT TIME ZONE 'UTC'), 'YYYY-MM')",
};

/**
 * Ledger totals grouped by run, region, provider or month. An estimate is "open" until a
 * correction reverses it; actuals are what providers reported.
 */
export async function costsBy(
  db: Queryable,
  userId: UserId,
  groupBy: CostGroupBy,
  filter: { month?: Date; runId?: string },
  page: PageQuery,
): Promise<{ items: CostRow[]; total: number }> {
  const key = GROUP_KEY[groupBy];
  const start = filter.month
    ? new Date(Date.UTC(filter.month.getUTCFullYear(), filter.month.getUTCMonth(), 1))
    : null;
  const end = start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) : null;
  const { rows } = await db.query<{
    key: string;
    open_estimate: number;
    actual: number;
    total_usd: number;
    entries: number;
    total: number;
  }>(
    `SELECT ${key} AS key,
            COALESCE(sum(l.amount_usd) FILTER (WHERE l.kind = 'estimated'), 0)::numeric AS open_estimate,
            COALESCE(sum(l.amount_usd) FILTER (WHERE l.kind = 'actual'), 0)::numeric AS actual,
            COALESCE(sum(l.amount_usd), 0)::numeric AS total_usd,
            count(*) FILTER (WHERE l.corrects_id IS NULL)::integer AS entries,
            count(*) OVER ()::integer AS total
       FROM cost_ledger l JOIN runs r ON r.id = l.run_id
      WHERE l.user_id = $1
        AND ($4::timestamptz IS NULL OR l.created_at >= $4)
        AND ($5::timestamptz IS NULL OR l.created_at < $5)
        AND ($6::uuid IS NULL OR l.run_id = $6)
      GROUP BY 1 ORDER BY 1 DESC LIMIT $2 OFFSET $3`,
    [userId, page.limit, page.offset, start, end, filter.runId ?? null],
  );
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    items: rows.map((r) => ({
      key: r.key,
      openEstimateUsd: round(r.open_estimate),
      actualUsd: round(r.actual),
      totalUsd: round(r.total_usd),
      entries: r.entries,
    })),
    total: rows[0]?.total ?? 0,
  };
}

export async function ledgerPage(
  db: Queryable,
  userId: UserId,
  runId: string,
  page: PageQuery,
): Promise<{ items: LedgerEntryView[]; total: number }> {
  const { rows } = await db.query<{
    id: string;
    run_step_id: string | null;
    provider: string;
    item: string;
    units: number;
    unit_price_usd: number;
    amount_usd: number;
    kind: 'estimated' | 'actual';
    corrects_id: string | null;
    created_at: Date;
    total: number;
  }>(
    `SELECT *, count(*) OVER ()::integer AS total FROM cost_ledger
      WHERE user_id = $1 AND run_id = $2 ORDER BY id LIMIT $3 OFFSET $4`,
    [userId, runId, page.limit, page.offset],
  );
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      runStepId: r.run_step_id,
      provider: r.provider,
      item: r.item,
      units: r.units,
      unitPriceUsd: r.unit_price_usd,
      amountUsd: r.amount_usd,
      kind: r.kind,
      correctsId: r.corrects_id === null ? null : String(r.corrects_id),
      createdAt: r.created_at.toISOString(),
    })),
    total: rows[0]?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------------------
// Apify log

interface EventRow {
  id: string;
  run_id: string;
  run_step_id: string;
  apify_run_id: string;
  state: ApifyEventView['state'];
  message: string | null;
  occurred_at: Date;
}

const toEventView = (r: EventRow): ApifyEventView => ({
  id: String(r.id),
  runId: r.run_id,
  runStepId: r.run_step_id,
  apifyRunId: r.apify_run_id,
  state: r.state,
  message: r.message,
  occurredAt: r.occurred_at.toISOString(),
});

export async function recentApifyEvents(
  db: Queryable,
  userId: UserId,
  page: PageQuery,
): Promise<{ items: ApifyEventView[]; total: number }> {
  const { rows } = await db.query<EventRow & { total: number }>(
    `SELECT *, count(*) OVER ()::integer AS total FROM apify_events WHERE user_id = $1
      ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [userId, page.limit, page.offset],
  );
  return { items: rows.map(toEventView), total: rows[0]?.total ?? 0 };
}

/** Steps with an Apify run, with their whole event history. */
export async function apifySteps(
  db: Queryable,
  userId: UserId,
  filter: { runIds?: string[]; inFlightOnly?: boolean; latestStates?: string[] },
): Promise<(ApifyStepView & { runId: string })[]> {
  const { rows } = await db.query<{
    id: string;
    run_id: string;
    stage: RunStage;
    step_key: string;
    actor_id: string | null;
    apify_run_id: string | null;
    apify_status: string | null;
    latest: ApifyEventView['state'] | null;
  }>(
    `SELECT s.id, s.run_id, s.stage, s.step_key, s.actor_id, s.apify_run_id, s.apify_status,
            (SELECT e.state FROM apify_events e WHERE e.run_step_id = s.id
              ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS latest
       FROM run_steps s
      WHERE s.user_id = $1 AND s.apify_run_id IS NOT NULL
        AND ($2::uuid[] IS NULL OR s.run_id = ANY($2))
        AND (NOT $3 OR (s.status IN ('started', 'running') AND s.processed_at IS NULL))
      ORDER BY s.created_at, s.id`,
    [userId, filter.runIds ?? null, filter.inFlightOnly ?? false],
  );
  const steps = filter.latestStates
    ? rows.filter((r) => r.latest && filter.latestStates!.includes(r.latest))
    : rows;
  if (steps.length === 0) return [];
  const events = await db.query<EventRow>(
    `SELECT * FROM apify_events WHERE user_id = $1 AND run_step_id = ANY($2::uuid[])
      ORDER BY occurred_at, id`,
    [userId, steps.map((s) => s.id)],
  );
  return steps.map((s) => ({
    runId: s.run_id,
    runStepId: s.id,
    stage: s.stage,
    stepKey: s.step_key,
    actorId: s.actor_id,
    apifyRunId: s.apify_run_id,
    apifyStatus: s.apify_status,
    latestState: s.latest,
    history: events.rows.filter((e) => e.run_step_id === s.id).map(toEventView),
  }));
}

export async function activeRunIds(db: Queryable, userId: UserId): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE user_id = $1 AND status IN ('pending', 'running')
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------------------
// Coverage

export async function cellQueries(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
  limit = 100,
) {
  const { rows } = await db.query<{
    query_text: string;
    provider: string;
    results_returned: number;
    new_places_found: number;
    cost_usd: number;
    created_at: Date;
  }>(
    `SELECT query_text, provider, results_returned, new_places_found, cost_usd, created_at
       FROM search_queries WHERE user_id = $1 AND region_cell_id = $2
      ORDER BY created_at DESC, id DESC LIMIT $3`,
    [userId, regionCellId, limit],
  );
  return rows.map((r) => ({
    queryText: r.query_text,
    provider: r.provider,
    resultsReturned: r.results_returned,
    newPlacesFound: r.new_places_found,
    costUsd: r.cost_usd,
    at: r.created_at.toISOString(),
  }));
}

export async function regionQueryTotals(
  db: Queryable,
  userId: UserId,
): Promise<Map<string, { queries: number; places: number; newPlaces: number }>> {
  const { rows } = await db.query<{ region_id: string; q: number; p: number; n: number }>(
    `SELECT rc.region_id, count(*)::integer AS q, COALESCE(sum(results_returned), 0)::integer AS p,
            COALESCE(sum(new_places_found), 0)::integer AS n
       FROM search_queries s JOIN region_cells rc ON rc.id = s.region_cell_id
      WHERE s.user_id = $1 GROUP BY 1`,
    [userId],
  );
  return new Map(rows.map((r) => [r.region_id, { queries: r.q, places: r.p, newPlaces: r.n }]));
}
