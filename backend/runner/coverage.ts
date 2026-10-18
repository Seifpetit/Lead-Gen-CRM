import type { Coverage, CoverageEntry, CoverageState } from '@lead-gen-crm/shared';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import {
  companySectors,
  exhaustionByRegion,
  leadTotalsByRegionSector,
  queryTotalsByRegionSector,
  spendByStep,
} from '../data/coverageMatrix.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { listRegions } from '../data/regions.js';
import { normalizeQuery } from '../lib/normalize.js';

const key = (regionId: string, sectorId: string | null) => `${regionId}\u0000${sectorId ?? ''}`;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Coverage per region and sector for one user.
 *
 * - queries and new places: search_queries, by the sector of the wording searched.
 * - leads: by the sector of the lead's company.
 * - spend: the cost ledger, settled (estimates replaced by actuals). A discovery step's spend
 *   goes to the sector it searched, a people search to its company's sector, an email batch is
 *   split evenly over its companies. Spend with no sector (typed-in wordings, model calls
 *   during qualify) is reported under sector null, so region totals still add up.
 * - state: not searched (no query yet); saturated when, in every cell of the region, either the
 *   cell is exhausted or all the sector's wordings are; otherwise still yielding.
 */
export async function buildCoverage(db: Queryable, userId: UserId): Promise<Coverage> {
  const [regions, queries, leads, steps, companies, exhaustion] = await Promise.all([
    listRegions(db),
    queryTotalsByRegionSector(db, userId),
    leadTotalsByRegionSector(db, userId),
    spendByStep(db, userId),
    companySectors(db, userId),
    exhaustionByRegion(db, userId),
  ]);

  const cells = new Map<
    string,
    { queries: number; newPlaces: number; leads: number; spend: number }
  >();
  const cell = (regionId: string, sectorId: string | null) => {
    const k = key(regionId, sectorId);
    let c = cells.get(k);
    if (!c) {
      c = { queries: 0, newPlaces: 0, leads: 0, spend: 0 };
      cells.set(k, c);
    }
    return c;
  };
  for (const q of queries) {
    const c = cell(q.regionId, q.sectorId);
    c.queries += q.queries;
    c.newPlaces += q.newPlaces;
  }
  for (const l of leads) cell(l.regionId, l.sectorId).leads += l.leads;
  for (const s of steps) {
    if (s.stage === 'discover') {
      cell(s.regionId, s.sectorId).spend += s.usd;
    } else if (s.stage === 'find_people' && s.companyId) {
      cell(s.regionId, companies.get(s.companyId) ?? null).spend += s.usd;
    } else if (s.stage === 'enrich' && s.refCompanyIds.length > 0) {
      for (const id of s.refCompanyIds) {
        cell(s.regionId, companies.get(id) ?? null).spend += s.usd / s.refCompanyIds.length;
      }
    } else {
      cell(s.regionId, null).spend += s.usd;
    }
  }

  const wordingsOf = new Map<string, string[]>(
    FREIGHT_SECTORS.map((s) => [s.id, s.searchTermsFr.map((t) => normalizeQuery(t))]),
  );
  const stateOf = (
    regionId: string,
    sectorId: string | null,
    queriesRun: number,
  ): CoverageState => {
    if (queriesRun === 0) return 'not_searched';
    const wordings = sectorId ? wordingsOf.get(sectorId) : undefined;
    const ex = exhaustion.get(regionId);
    if (!wordings || !ex || ex.cells.length === 0) return 'yielding';
    const done = ex.cells.every(
      (id) =>
        ex.exhaustedCells.has(id) || wordings.every((w) => ex.wordings.get(id)?.has(w) ?? false),
    );
    return done ? 'saturated' : 'yielding';
  };

  const entries: CoverageEntry[] = [];
  const sectorIds: (string | null)[] = [...FREIGHT_SECTORS.map((s) => s.id), null];
  for (const r of regions) {
    for (const sectorId of sectorIds) {
      const c = cells.get(key(r.id, sectorId));
      // The "other" bucket only appears when something landed in it.
      if (sectorId === null && !c) continue;
      const queriesRun = c?.queries ?? 0;
      const spendUsd = round6(c?.spend ?? 0);
      entries.push({
        regionId: r.id,
        sectorId,
        queriesRun,
        newPlaces: c?.newPlaces ?? 0,
        leads: c?.leads ?? 0,
        spendUsd,
        costPerLeadUsd: c && c.leads > 0 ? round6(c.spend / c.leads) : null,
        state: stateOf(r.id, sectorId, queriesRun),
      });
    }
  }
  return {
    regions: regions.map((r) => ({ regionId: r.id, name: r.name })),
    sectors: FREIGHT_SECTORS.map((s) => ({ id: s.id, name: s.name })),
    entries,
  };
}
