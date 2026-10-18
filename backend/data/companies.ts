import { withTransaction, type Queryable } from './db.js';
import { insertEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import { normalizeCompanyName, normalizeDomain, normalizeEmail } from './normalize.js';
import type { Sourced } from './sourced.js';

/** Postgres unique_violation: a concurrent writer inserted the same key first. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export interface CompanyRecord {
  id: string;
  name: string;
  normalizedName: string;
  governorate: string;
  sector: string | null;
  googlePlaceId: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  sourceProvider: string | null;
  refreshBy: Date | null;
  /** The run and map cell that first found this company. */
  runId: string | null;
  regionCellId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Every value arrives with its source. Optional fields are left unchanged when absent. */
export interface CompanyInput {
  name: Sourced<string>;
  /** A region ID from the regions table. */
  governorate: Sourced<string>;
  googlePlaceId?: Sourced<string>;
  website?: Sourced<string>;
  sector?: Sourced<string>;
  phone?: Sourced<string>;
  email?: Sourced<string>;
  linkedinUrl?: Sourced<string>;
  /** Provider the fields came from, e.g. 'google_maps'. Metadata, not a sourced fact. */
  sourceProvider?: string;
  /** When this provider's content must be refreshed or dropped under its storage terms. */
  refreshBy?: Date;
  /** The map cell the company was found in (kept from the first find). */
  regionCellId?: string;
}

export type MatchedBy = 'google_place_id' | 'domain' | 'name_governorate' | null;

export interface UpsertCompanyResult {
  company: CompanyRecord;
  created: boolean;
  matchedBy: MatchedBy;
}

interface Row {
  id: string;
  name: string;
  normalized_name: string;
  governorate: string;
  sector: string | null;
  google_place_id: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  source_provider: string | null;
  refresh_by: Date | null;
  run_id: string | null;
  region_cell_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const toCompany = (r: Row): CompanyRecord => ({
  id: r.id,
  name: r.name,
  normalizedName: r.normalized_name,
  governorate: r.governorate,
  sector: r.sector,
  googlePlaceId: r.google_place_id,
  domain: r.domain,
  website: r.website,
  phone: r.phone,
  email: r.email,
  linkedinUrl: r.linkedin_url,
  sourceProvider: r.source_provider,
  refreshBy: r.refresh_by,
  runId: r.run_id,
  regionCellId: r.region_cell_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Finds the existing company in priority order: Google place ID, then normalized domain,
 * then normalized name plus governorate. A name match is skipped when both sides carry a
 * different place ID or domain: those are two businesses that share a name (e.g. branches).
 */
async function findMatch(
  db: Queryable,
  userId: UserId,
  key: {
    placeId: string | null;
    domain: string | null;
    normalizedName: string;
    governorate: string;
  },
): Promise<{ row: Row; matchedBy: Exclude<MatchedBy, null> } | null> {
  if (key.placeId) {
    const { rows } = await db.query<Row>(
      'SELECT * FROM companies WHERE user_id = $1 AND google_place_id = $2 FOR UPDATE',
      [userId, key.placeId],
    );
    if (rows[0]) return { row: rows[0], matchedBy: 'google_place_id' };
  }
  if (key.domain) {
    const { rows } = await db.query<Row>(
      'SELECT * FROM companies WHERE user_id = $1 AND domain = $2 FOR UPDATE',
      [userId, key.domain],
    );
    if (rows[0]) return { row: rows[0], matchedBy: 'domain' };
  }
  const { rows } = await db.query<Row>(
    `SELECT * FROM companies
      WHERE user_id = $1 AND normalized_name = $2 AND governorate = $3
        AND ($4::text IS NULL OR google_place_id IS NULL OR google_place_id = $4)
        AND ($5::text IS NULL OR domain IS NULL OR domain = $5)
      ORDER BY created_at LIMIT 1 FOR UPDATE`,
    [userId, key.normalizedName, key.governorate, key.placeId, key.domain],
  );
  return rows[0] ? { row: rows[0], matchedBy: 'name_governorate' } : null;
}

/**
 * Inserts or merges a company and records evidence for every value given. On a match,
 * newer values replace older ones, except identifiers (place ID, domain), which are only
 * filled in when empty. Evidence keeps the full history either way.
 */
export async function upsertCompany(
  db: Queryable,
  userId: UserId,
  input: CompanyInput,
  runId: string | null = null,
): Promise<UpsertCompanyResult> {
  return withTransaction(db, async (tx) => {
    const normalizedName = normalizeCompanyName(input.name.value);
    const placeId = input.googlePlaceId?.value.trim() || null;
    const domain = input.website ? normalizeDomain(input.website.value) : null;
    let match = await findMatch(tx, userId, {
      placeId,
      domain,
      normalizedName,
      governorate: input.governorate.value,
    });

    const values = {
      name: input.name.value.trim(),
      normalized_name: normalizedName,
      governorate: input.governorate.value,
      sector: input.sector?.value ?? null,
      website: input.website?.value.trim() ?? null,
      phone: input.phone?.value.trim() ?? null,
      email: input.email ? normalizeEmail(input.email.value) : null,
      linkedin_url: input.linkedinUrl?.value.trim() ?? null,
      source_provider: input.sourceProvider ?? null,
      refresh_by: input.refreshBy ?? null,
    };

    let row: Row;
    // Another transaction may insert the same company between our lookup and our insert. The
    // unique indexes reject the second insert; we then merge into the winner instead of failing.
    let inserted: Row | null = null;
    if (!match) {
      await tx.query('SAVEPOINT upsert_company');
      try {
        inserted = await insertCompany();
        await tx.query('RELEASE SAVEPOINT upsert_company');
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await tx.query('ROLLBACK TO SAVEPOINT upsert_company');
        match = await findMatch(tx, userId, {
          placeId,
          domain,
          normalizedName,
          governorate: input.governorate.value,
        });
        if (!match) throw err;
      }
    }
    async function insertCompany(): Promise<Row> {
      const { rows } = await tx.query<Row>(
        `INSERT INTO companies (user_id, name, normalized_name, governorate, sector, google_place_id,
                                domain, website, phone, email, linkedin_url, source_provider, refresh_by,
                                run_id, region_cell_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [
          userId,
          values.name,
          normalizedName,
          values.governorate,
          values.sector,
          placeId,
          domain,
          values.website,
          values.phone,
          values.email,
          values.linkedin_url,
          values.source_provider,
          values.refresh_by,
          runId,
          input.regionCellId ?? null,
        ],
      );
      return rows[0]!;
    }
    if (inserted) {
      row = inserted;
    } else {
      match = match!;
      // Identifiers fill only when empty and not already owned by another company.
      const { rows } = await tx.query<Row>(
        `UPDATE companies c SET
           name = $3, normalized_name = $4, governorate = $5,
           sector = COALESCE($6, c.sector),
           google_place_id = COALESCE(c.google_place_id, CASE WHEN NOT EXISTS
             (SELECT 1 FROM companies o WHERE o.user_id = $1 AND o.google_place_id = $7) THEN $7 END),
           domain = COALESCE(c.domain, CASE WHEN NOT EXISTS
             (SELECT 1 FROM companies o WHERE o.user_id = $1 AND o.domain = $8) THEN $8 END),
           website = COALESCE($9, c.website), phone = COALESCE($10, c.phone),
           email = COALESCE($11, c.email), linkedin_url = COALESCE($12, c.linkedin_url),
           source_provider = COALESCE($13, c.source_provider),
           refresh_by = COALESCE($14, c.refresh_by),
           run_id = COALESCE(c.run_id, $15), region_cell_id = COALESCE(c.region_cell_id, $16),
           updated_at = now()
         WHERE c.user_id = $1 AND c.id = $2 RETURNING *`,
        [
          userId,
          match.row.id,
          values.name,
          normalizedName,
          values.governorate,
          values.sector,
          placeId,
          domain,
          values.website,
          values.phone,
          values.email,
          values.linkedin_url,
          values.source_provider,
          values.refresh_by,
          runId,
          input.regionCellId ?? null,
        ],
      );
      row = rows[0]!;
    }

    const target = { companyId: row.id };
    const { sourceProvider, refreshBy, regionCellId, ...sourcedFields } = input;
    for (const [field, sourced] of Object.entries(sourcedFields) as [
      string,
      Sourced<string> | undefined,
    ][]) {
      if (sourced) await insertEvidence(tx, userId, target, field, sourced, runId);
    }
    return { company: toCompany(row), created: !match, matchedBy: match?.matchedBy ?? null };
  });
}

export async function getCompany(
  db: Queryable,
  userId: UserId,
  companyId: string,
): Promise<CompanyRecord | null> {
  const { rows } = await db.query<Row>('SELECT * FROM companies WHERE user_id = $1 AND id = $2', [
    userId,
    companyId,
  ]);
  return rows[0] ? toCompany(rows[0]) : null;
}

export async function listCompanies(
  db: Queryable,
  userId: UserId,
  filter: { governorate?: string } = {},
): Promise<CompanyRecord[]> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM companies WHERE user_id = $1 AND ($2::text IS NULL OR governorate = $2)
      ORDER BY name`,
    [userId, filter.governorate ?? null],
  );
  return rows.map(toCompany);
}

/** Companies whose provider content must be refreshed or dropped by `now`, oldest first. */
export async function listCompaniesDueForRefresh(
  db: Queryable,
  userId: UserId,
  now: Date,
): Promise<CompanyRecord[]> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM companies WHERE user_id = $1 AND refresh_by <= $2 ORDER BY refresh_by`,
    [userId, now],
  );
  return rows.map(toCompany);
}

/** Records the company's sector (with its evidence) without touching other fields. */
export async function setCompanySector(
  db: Queryable,
  userId: UserId,
  companyId: string,
  sector: Sourced<string>,
  runId: string | null,
): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const res = await tx.query(
      'UPDATE companies SET sector = $3, updated_at = now() WHERE user_id = $1 AND id = $2',
      [userId, companyId, sector.value],
    );
    if (res.rowCount === 0) return false;
    await insertEvidence(tx, userId, { companyId }, 'sector', sector, runId);
    return true;
  });
}
