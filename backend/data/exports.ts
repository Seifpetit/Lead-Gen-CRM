import {
  EXPORT_MAX_ROWS,
  googleMapsUrl,
  whatsappNumber,
  type CrmCard,
  type CrmPipeline,
  type CrmStage,
  type ExportRow,
} from '@lead-gen-crm/shared';
import { cityFromAddress } from '@lead-gen-crm/shared';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import { listCards, listStages, type CardListOptions } from './crmBoards.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// The rows of an export, read a page at a time and always scoped to one user. Two sources:
// the CRM cards (dashboard leads, the CRM table) and the scored leads of runs (Runs page).

const sectorName = (id: string | null): string | null =>
  id ? (FREIGHT_SECTORS.find((s) => s.id === id)?.name ?? id) : null;

/** What one export holds: its rows and whether it stopped at the limit. */
export interface ExportData {
  rows: ExportRow[];
  /** Everything that matched, which can be more than the rows when the limit was reached. */
  total: number;
}

export function cardToRow(card: CrmCard, stageName: string): ExportRow {
  const { company, person } = card;
  const phone = (person ? person.phone : null) ?? company.phone;
  return {
    company: company.name,
    person: person?.fullName || null,
    role: person?.title ?? null,
    sector: sectorName(company.sector),
    city: company.city,
    phone,
    whatsapp: whatsappNumber(phone) !== null,
    email: (person ? person.email : null) ?? company.email,
    website: company.website,
    score: card.score,
    stage: stageName,
    foundAt: card.foundAt,
    mapsUrl: googleMapsUrl(company.name, company.location, company.city),
  };
}

/** The cards matching the board filters, page after page, up to `max` rows. */
export async function cardExportRows(
  db: Queryable,
  userId: UserId,
  pipeline: CrmPipeline,
  retentionDays: number,
  filters: Omit<CardListOptions, 'cursor' | 'limit'>,
  max = EXPORT_MAX_ROWS,
): Promise<ExportData> {
  const names = new Map((await listStages(db, pipeline)).map((s) => [s.key, s.name]));
  const rows: ExportRow[] = [];
  let cursor: string | undefined;
  let total: number;
  do {
    const page = await listCards(db, userId, pipeline, retentionDays, {
      ...filters,
      limit: 100,
      cursor,
    });
    total = page.total;
    for (const card of page.cards) {
      if (rows.length >= max) break;
      rows.push(cardToRow(card, names.get(card.stage) ?? card.stage));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < max);
  return { rows, total };
}

export interface LeadExportFilter {
  runIds?: string[] | undefined;
  stage?: CrmStage[] | undefined;
  regionId?: string | undefined;
  minScore?: number | undefined;
  q?: string | undefined;
}

/** The lead stages as the Runs page names them. */
export const LEAD_STAGE_NAMES: Record<CrmStage, string> = {
  system_suggested: 'Suggested',
  confirmed: 'Confirmed',
  contacted: 'Contacted',
  response: 'Replied',
  dismissed: 'Dismissed',
  won: 'Won',
  lost: 'Lost',
  opted_out: 'Opted out',
};

const PAGE = 500;

/** The scored leads of runs (best score first, like the Runs page), up to `max` rows. */
export async function leadExportRows(
  db: Queryable,
  userId: UserId,
  filter: LeadExportFilter,
  max = EXPORT_MAX_ROWS,
): Promise<ExportData> {
  const rows: ExportRow[] = [];
  let total = 0;
  for (let offset = 0; rows.length < max; offset += PAGE) {
    const { rows: page } = await db.query<{
      total: number;
      company: string;
      full_name: string | null;
      title: string | null;
      sector: string | null;
      address: string | null;
      company_phone: string | null;
      person_phone: string | null;
      company_email: string | null;
      person_email: string | null;
      website: string | null;
      score_total: number;
      stage: CrmStage;
      created_at: Date;
      lat: number | null;
      lng: number | null;
    }>(
      `SELECT count(*) OVER ()::integer AS total,
              c.name AS company, p.full_name, p.title, c.sector, c.address,
              c.phone AS company_phone, p.phone AS person_phone,
              c.email AS company_email, p.email AS person_email, c.website,
              l.score_total, l.stage, l.created_at, c.lat, c.lng
         FROM crm_leads l
         JOIN companies c ON c.id = l.company_id AND c.user_id = l.user_id
         LEFT JOIN contacts p ON p.id = l.contact_id AND p.user_id = l.user_id
        WHERE l.user_id = $1
          AND ($2::uuid[] IS NULL OR l.run_id = ANY($2::uuid[]))
          AND ($3::text[] IS NULL OR l.stage = ANY($3))
          AND ($4::text IS NULL OR c.governorate = $4)
          AND ($5::int IS NULL OR l.score_total >= $5)
          AND ($6::text IS NULL OR c.name ILIKE $6 OR p.full_name ILIKE $6)
        ORDER BY l.score_total DESC, l.created_at, l.id
        LIMIT $7 OFFSET $8`,
      [
        userId,
        filter.runIds && filter.runIds.length > 0 ? filter.runIds : null,
        filter.stage && filter.stage.length > 0 ? filter.stage : null,
        filter.regionId ?? null,
        filter.minScore ?? null,
        filter.q ? `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null,
        Math.min(PAGE, max - rows.length),
        offset,
      ],
    );
    if (page.length === 0) break;
    total = page[0]!.total;
    for (const r of page) {
      const phone = r.person_phone ?? r.company_phone;
      const city = cityFromAddress(r.address);
      rows.push({
        company: r.company,
        person: r.full_name,
        role: r.title,
        sector: sectorName(r.sector),
        city,
        phone,
        whatsapp: whatsappNumber(phone) !== null,
        email: r.person_email ?? r.company_email,
        website: r.website,
        score: r.score_total,
        stage: LEAD_STAGE_NAMES[r.stage] ?? r.stage,
        foundAt: r.created_at.toISOString(),
        mapsUrl: googleMapsUrl(
          r.company,
          r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
          city,
        ),
      });
    }
    if (offset + page.length >= total) break;
  }
  return { rows, total };
}
