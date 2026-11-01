import type { CountryCode, TradeRole } from '@lead-gen-crm/shared';
import { withTransaction, type Queryable } from './db.js';
import { haversineKm } from '../lib/geo.js';
import { insertEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import {
  classifyPhone,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
} from './normalize.js';
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
  /** What the company does in international trade; null until it has been checked. */
  tradeRole: TradeRole | null;
  googlePlaceId: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  /** The phone in E.164, for matching the same business; null when it is not a usable number. */
  phoneE164: string | null;
  /** True when the phone carries a country code other than +216. */
  phoneForeign: boolean;
  email: string | null;
  linkedinUrl: string | null;
  /** Where Google puts the business, as plain numbers; null when unknown. */
  location: { lat: number; lng: number } | null;
  /** Google's own category label ("Corporate office"). */
  category: string | null;
  address: string | null;
  /** Thumbnail address (never the picture), from the page or the Maps photo. */
  imageUrl: string | null;
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
  /** Google's category label and street address; kept as evidence too. */
  category?: Sourced<string>;
  address?: Sourced<string>;
  /** Where the business is; a pair of numbers, not a sourced text. */
  location?: { lat: number; lng: number };
  /** Provider the fields came from, e.g. 'google_maps'. Metadata, not a sourced fact. */
  sourceProvider?: string;
  /** When this provider's content must be refreshed or dropped under its storage terms. */
  refreshBy?: Date;
  /** The map cell the company was found in (kept from the first find). */
  regionCellId?: string;
  /** The country it was found in; its phone number is read by that country's rules. Default Tunisia. */
  country?: CountryCode;
}

export type MatchedBy =
  'google_place_id' | 'phone' | 'domain' | 'name_governorate' | 'name_nearby' | null;

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
  trade_role: TradeRole | null;
  google_place_id: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  phone_e164: string | null;
  phone_foreign: boolean;
  email: string | null;
  linkedin_url: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  address: string | null;
  image_url: string | null;
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
  tradeRole: r.trade_role,
  googlePlaceId: r.google_place_id,
  domain: r.domain,
  website: r.website,
  phone: r.phone,
  phoneE164: r.phone_e164,
  phoneForeign: r.phone_foreign,
  email: r.email,
  linkedinUrl: r.linkedin_url,
  location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
  category: r.category,
  address: r.address,
  imageUrl: r.image_url,
  sourceProvider: r.source_provider,
  refreshBy: r.refresh_by,
  runId: r.run_id,
  regionCellId: r.region_cell_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SAME_PLACE_KM = 0.1;

/**
 * Finds the existing company in priority order: Google place ID, then normalized phone, then
 * normalized website domain, then normalized name plus governorate. A name match is skipped
 * when both sides carry a different place ID or domain: those are two businesses that share a
 * name (e.g. branches). Phone and website are checked before the name because a shared number
 * or site is a stronger sign of the same business than a similar name.
 */
async function findMatch(
  db: Queryable,
  userId: UserId,
  key: {
    placeId: string | null;
    phoneE164: string | null;
    domain: string | null;
    normalizedName: string;
    governorate: string;
    location: { lat: number; lng: number } | null;
  },
): Promise<{ row: Row; matchedBy: Exclude<MatchedBy, null> } | null> {
  if (key.placeId) {
    const { rows } = await db.query<Row>(
      'SELECT * FROM companies WHERE user_id = $1 AND google_place_id = $2 FOR UPDATE',
      [userId, key.placeId],
    );
    if (rows[0]) return { row: rows[0], matchedBy: 'google_place_id' };
  }
  if (key.phoneE164) {
    const { rows } = await db.query<Row>(
      `SELECT * FROM companies WHERE user_id = $1 AND phone_e164 = $2
        ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [userId, key.phoneE164],
    );
    if (rows[0]) return { row: rows[0], matchedBy: 'phone' };
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
  if (rows[0]) return { row: rows[0], matchedBy: 'name_governorate' };
  // The same name within SAME_PLACE_KM is one business that Google lists twice (two place IDs
  // for one shop). Branches with the same name are further apart than this.
  if (key.location) {
    const near = await db.query<Row>(
      `SELECT * FROM companies
        WHERE user_id = $1 AND normalized_name = $2 AND governorate = $3
          AND lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY created_at FOR UPDATE`,
      [userId, key.normalizedName, key.governorate],
    );
    const hit = near.rows.find(
      (r) => haversineKm(key.location!, { lat: r.lat!, lng: r.lng! }) <= SAME_PLACE_KM,
    );
    if (hit) return { row: hit, matchedBy: 'name_nearby' };
  }
  return null;
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
    const phone = input.phone ? classifyPhone(input.phone.value, input.country) : null;
    const phoneE164 = phone?.e164 ?? null;
    let match = await findMatch(tx, userId, {
      placeId,
      phoneE164,
      domain,
      normalizedName,
      governorate: input.governorate.value,
      location: input.location ?? null,
    });

    const values = {
      name: input.name.value.trim(),
      normalized_name: normalizedName,
      governorate: input.governorate.value,
      sector: input.sector?.value ?? null,
      website: input.website?.value.trim() ?? null,
      phone: input.phone?.value.trim() ?? null,
      phone_e164: phoneE164,
      phone_foreign: phone?.foreign ?? false,
      email: input.email ? normalizeEmail(input.email.value) : null,
      linkedin_url: input.linkedinUrl?.value.trim() ?? null,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      category: input.category?.value.trim() || null,
      address: input.address?.value.trim() || null,
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
          phoneE164,
          domain,
          normalizedName,
          governorate: input.governorate.value,
          location: input.location ?? null,
        });
        if (!match) throw err;
      }
    }
    async function insertCompany(): Promise<Row> {
      const { rows } = await tx.query<Row>(
        `INSERT INTO companies (user_id, name, normalized_name, governorate, sector, google_place_id,
                                domain, website, phone, email, linkedin_url, source_provider, refresh_by,
                                run_id, region_cell_id, phone_e164, phone_foreign,
                                lat, lng, category, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21)
         RETURNING *`,
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
          values.phone_e164,
          values.phone_foreign,
          values.lat,
          values.lng,
          values.category,
          values.address,
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
           phone_e164 = CASE WHEN $10 IS NULL THEN c.phone_e164 ELSE $17 END,
           phone_foreign = CASE WHEN $10 IS NULL THEN c.phone_foreign ELSE $18 END,
           lat = COALESCE($19, c.lat), lng = COALESCE($20, c.lng),
           category = COALESCE($21, c.category), address = COALESCE($22, c.address),
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
          values.phone_e164,
          values.phone_foreign,
          values.lat,
          values.lng,
          values.category,
          values.address,
        ],
      );
      row = rows[0]!;
    }

    const target = { companyId: row.id };
    const { sourceProvider, refreshBy, regionCellId, location, country, ...sourcedFields } = input;
    void country;
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

/**
 * Records what the company does in international trade. Evidence for it is the classifier's
 * evidence rows (or the name and category for a rule), written by the caller.
 */
export async function setCompanyTradeRole(
  db: Queryable,
  userId: UserId,
  companyId: string,
  tradeRole: TradeRole,
): Promise<boolean> {
  const res = await db.query(
    'UPDATE companies SET trade_role = $3, updated_at = now() WHERE user_id = $1 AND id = $2',
    [userId, companyId, tradeRole],
  );
  return (res.rowCount ?? 0) > 0;
}
