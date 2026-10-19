import type { Lead } from '@lead-gen-crm/shared';

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

/**
 * Whether leads per day read better as bars than as a line: when the range is a week or less, or
 * when most of its days are empty (a line would only dip to zero between a few spikes).
 */
export function showAsBars(days: readonly DayCount[]): boolean {
  if (days.length <= 7) return true;
  const empty = days.filter((d) => d.count === 0).length;
  return empty * 2 > days.length;
}
