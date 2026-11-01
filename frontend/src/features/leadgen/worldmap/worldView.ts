import type { CountryCode, CountryInfo, MapPin, RegionSummary } from '@lead-gen-crm/shared';
import { isExplored } from '../../../lib/coverageView.js';
import type { RegionTone } from './worldMapController.js';

// What the Coverage world map and its panels show, worked out from the server's lists. Pure.

/** The colour a region gets: saturated, worked on, or untouched. */
export function regionTone(
  r: Pick<RegionSummary, 'status' | 'queriesRun' | 'leads' | 'runs'>,
): RegionTone {
  if (r.status === 'saturated') return 'saturated';
  return r.queriesRun > 0 || r.leads > 0 || r.runs > 0 ? 'active' : 'none';
}

export function toneMap(list: readonly RegionSummary[]): Map<string, RegionTone> {
  return new Map(list.map((r) => [r.regionId, regionTone(r)]));
}

/** Explored regions first, most covered first (ties by name); the untouched ones after, by name. */
export function sortRegions(list: readonly RegionSummary[]): RegionSummary[] {
  const byName = (a: RegionSummary, b: RegionSummary) => a.name.localeCompare(b.name);
  const explored = list
    .filter(isExplored)
    .sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0) || byName(a, b));
  const rest = list.filter((r) => !isExplored(r)).sort(byName);
  return [...explored, ...rest];
}

export interface CountryTotals {
  code: CountryCode;
  name: string;
  enabled: boolean;
  disabledReason: string | null;
  /** Companies with a place on the map. */
  companies: number;
  leads: number;
  spendUsd: number;
  regions: number;
  regionsExplored: number;
}

/** One row per country: the supported ones first (most companies first), then the switched-off. */
export function countryTotals(
  countries: readonly CountryInfo[],
  summaries: readonly RegionSummary[],
  pins: readonly MapPin[],
): CountryTotals[] {
  const rows = countries.map((c): CountryTotals => {
    const own = summaries.filter((r) => r.country === c.code);
    return {
      code: c.code,
      name: c.name,
      enabled: c.enabled,
      disabledReason: c.disabledReason,
      companies: pins.filter((p) => p.country === c.code).length,
      leads: own.reduce((n, r) => n + r.leads, 0),
      spendUsd: own.reduce((n, r) => n + r.spendUsd, 0),
      regions: c.regions,
      regionsExplored: own.filter(isExplored).length,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      b.companies - a.companies ||
      a.name.localeCompare(b.name),
  );
}

/** How many pinned companies each region has. */
export function pinsPerRegion(pins: readonly MapPin[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of pins) counts.set(p.regionId, (counts.get(p.regionId) ?? 0) + 1);
  return counts;
}
