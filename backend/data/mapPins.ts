import {
  cityFromAddress,
  type BoardStageKey,
  type CountryCode,
  type MapPin,
  type MapPins,
  type TradeRole,
} from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

/** More than this many pins are not drawn; the map says how many were left out. */
export const MAP_PIN_LIMIT = 5000;

interface Row {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: CountryCode;
  governorate: string;
  sector: string | null;
  trade_role: TradeRole | null;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  stage: BoardStageKey | null;
  score: number | null;
  run_id: string | null;
  lead_id: string | null;
  total: number;
}

/**
 * The user's companies that have a place on the map, newest first, optionally of one country.
 * Companies in Noise (removed from the board) are left out.
 */
export async function listMapPins(
  db: Queryable,
  userId: UserId,
  country?: CountryCode,
): Promise<MapPins> {
  const { rows } = await db.query<Row>(
    `WITH pins AS (
       SELECT c.id, c.name, c.lat, c.lng, c.country, c.governorate, c.sector, c.trade_role,
              c.category, c.address, c.phone, c.website, c.created_at,
              k.stage, bl.score_total::integer AS score, bl.run_id, bl.id AS lead_id
         FROM companies c
         LEFT JOIN crm_cards k
                ON k.user_id = c.user_id AND k.company_id = c.id AND k.pipeline = 'companies'
         LEFT JOIN LATERAL (
           SELECT l.id, l.run_id, l.score_total FROM crm_leads l
            WHERE l.user_id = c.user_id AND l.company_id = c.id
            ORDER BY l.score_total DESC, l.created_at, l.id LIMIT 1
         ) bl ON true
        WHERE c.user_id = $1 AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND (k.stage IS NULL OR k.stage <> 'noise')
          AND ($2::text IS NULL OR c.country = $2)
     )
     SELECT *, (SELECT count(*)::integer FROM pins) AS total
       FROM pins ORDER BY created_at DESC, id LIMIT ${MAP_PIN_LIMIT}`,
    [userId, country ?? null],
  );
  const items: MapPin[] = rows.map((r) => ({
    companyId: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    country: r.country,
    regionId: r.governorate,
    sector: r.sector,
    tradeRole: r.trade_role,
    category: r.category,
    city: cityFromAddress(r.address),
    phone: r.phone,
    website: r.website,
    stage: r.stage,
    score: r.score,
    runId: r.run_id,
    leadId: r.lead_id,
  }));
  return { items, total: rows[0]?.total ?? 0 };
}
