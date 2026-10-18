import type { Lead } from '@lead-gen-crm/shared';
import { bestChannel, companyChannels, type Channel } from '../../lib/lead.js';

export const LEAD_TABS = ['all', 'confirmed', 'dismissed'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];
export const LEAD_SORTS = ['newest', 'score', 'company'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];
export const SCORE_FILTERS = ['any', '50', '70'] as const;
export type ScoreFilter = (typeof SCORE_FILTERS)[number];

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const DAY_MS = 86_400_000;

/**
 * When the lead was found. Leads carry no date of their own, so this is the earliest time any
 * of their facts was read from a source; failing that, the day their run started.
 */
export function foundAt(lead: Lead, runStarted: ReadonlyMap<string, string>): string | null {
  const times = [...lead.company.evidence, ...(lead.contact?.evidence ?? [])]
    .map((e) => Date.parse(e.fetchedAt))
    .filter((n) => Number.isFinite(n));
  if (times.length > 0) return new Date(Math.min(...times)).toISOString();
  return runStarted.get(lead.runId) ?? null;
}

/** The best way to reach the lead: the person's channel first, the company's only as fallback. */
export function leadChannel(lead: Lead): Channel | null {
  return bestChannel(lead.contact) ?? companyChannels(lead.company)[0] ?? null;
}

export interface LeadFilters {
  tab: LeadTab;
  query: string;
  score: ScoreFilter;
  sort: LeadSort;
}

const TAB_STAGES: Record<Exclude<LeadTab, 'all'>, Lead['crmStage']> = {
  confirmed: 'confirmed',
  dismissed: 'dismissed',
};

export function inTab(lead: Lead, tab: LeadTab): boolean {
  return tab === 'all' || lead.crmStage === TAB_STAGES[tab];
}

/** Search, filter and sort what is loaded. Search looks at the company, person, title and website. */
export function applyView(
  leads: readonly Lead[],
  filters: LeadFilters,
  runStarted: ReadonlyMap<string, string>,
): Lead[] {
  const needle = filters.query.trim().toLowerCase();
  const minScore = filters.score === 'any' ? 0 : Number(filters.score);
  const found = new Map(leads.map((l) => [l.id, foundAt(l, runStarted) ?? '']));
  const rows = leads.filter((lead) => {
    if (!inTab(lead, filters.tab)) return false;
    if (lead.score.total < minScore) return false;
    if (needle === '') return true;
    return [
      lead.company.name,
      lead.company.website,
      lead.contact?.fullName,
      lead.contact?.title,
    ].some((text) => text?.toLowerCase().includes(needle));
  });
  const byName = (a: Lead, b: Lead) => a.company.name.localeCompare(b.company.name);
  const sorters: Record<LeadSort, (a: Lead, b: Lead) => number> = {
    newest: (a, b) => found.get(b.id)!.localeCompare(found.get(a.id)!) || byName(a, b),
    score: (a, b) => b.score.total - a.score.total || byName(a, b),
    company: byName,
  };
  return rows.sort(sorters[filters.sort]);
}

export interface DayCount {
  /** YYYY-MM-DD, in UTC. */
  day: string;
  count: number;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Leads found on each of the last `days` days (today included), zeros kept. */
export function leadsPerDay(
  leads: readonly Lead[],
  runStarted: ReadonlyMap<string, string>,
  days: number,
  now: number,
): DayCount[] {
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) counts.set(dayKey(now - i * DAY_MS), 0);
  for (const lead of leads) {
    const at = foundAt(lead, runStarted);
    const key = at ? at.slice(0, 10) : null;
    if (key !== null && counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  return [...counts].map(([day, count]) => ({ day, count }));
}

export interface SectorCount {
  sectorId: string | null;
  count: number;
}

/** Leads found in the last `days` days, per sector, most first. */
export function leadsBySector(
  leads: readonly Lead[],
  runStarted: ReadonlyMap<string, string>,
  days: number,
  now: number,
): SectorCount[] {
  const since = dayKey(now - (days - 1) * DAY_MS);
  const counts = new Map<string | null, number>();
  for (const lead of leads) {
    const at = foundAt(lead, runStarted);
    if (at === null || at.slice(0, 10) < since) continue;
    const key = lead.company.sector;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([sectorId, count]) => ({ sectorId, count }))
    .sort((a, b) => b.count - a.count);
}
