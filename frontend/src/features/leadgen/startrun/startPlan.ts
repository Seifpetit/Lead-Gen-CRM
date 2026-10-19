import type { Coverage, RegionSummary, RunPreview, RunSummary } from '@lead-gen-crm/shared';
import type { Translate } from '../../../i18n/index.js';
import { yieldOf } from '../../../lib/coverageView.js';

// What Start a run fills in and decides before the person touches anything. Pure, no React.

export const DEFAULT_CAP_USD = 2;
/** The quick choices next to the cap field. */
export const QUICK_CAPS_USD = [1, 2, 5] as const;
/** A cap above this asks for a second click, so a typo cannot start an expensive run. */
export const CONFIRM_ABOVE_USD = 5;
const CAP_KEY = 'leadgen.run.cap';

/** The cap used for the last run started, else $2. */
export function readCap(): number {
  try {
    const n = Number(window.localStorage.getItem(CAP_KEY));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
  } catch {
    return DEFAULT_CAP_USD;
  }
}

export function saveCap(cap: number): void {
  try {
    window.localStorage.setItem(CAP_KEY, String(cap));
  } catch {
    // Not remembered; the next run starts on $2.
  }
}

/** The text of a cap field that holds a number of dollars. */
export const capText = (cap: number): string => cap.toFixed(2);

/** A number from the cap field, or null when it is empty, not a number or not above zero. */
export function parseCap(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The sector worth searching next in a region: of those searched but not yet saturated, the one
 * that finds the most new places per search. None for a region with no history to go on, so a
 * fresh region starts with nothing ticked rather than everything.
 */
export function suggestedSectors(coverage: Pick<Coverage, 'entries'>, regionId: string): string[] {
  let best: { id: string; yield: number; leads: number } | null = null;
  for (const e of coverage.entries) {
    if (e.regionId !== regionId || e.sectorId === null || e.state !== 'yielding') continue;
    const y = yieldOf(e);
    if (y === null) continue;
    if (!best || y > best.yield || (y === best.yield && e.leads > best.leads)) {
      best = { id: e.sectorId, yield: y, leads: e.leads };
    }
  }
  return best ? [best.id] : [];
}

/** How far a region has got, for its entry in the list: not started, partly or fully covered. */
export type RegionProgress = 'new' | 'partly' | 'saturated';
export function regionProgress(r: Pick<RegionSummary, 'coverage' | 'status'>): RegionProgress {
  if (r.status === 'saturated') return 'saturated';
  return r.coverage === null || r.coverage <= 0 ? 'new' : 'partly';
}

/**
 * A rough range around the expected leads, or null when the estimate is too small to say
 * anything (never a bare 0). It is a band around the estimate, not a statistical interval.
 */
export function leadsRange(leads: number): { low: number; high: number } | null {
  if (!Number.isFinite(leads) || leads < 1) return null;
  return { low: Math.max(1, Math.floor(leads * 0.5)), high: Math.ceil(leads * 1.5) };
}

export interface ConfirmReason {
  aboveCap: boolean;
  bigCap: boolean;
}

/**
 * Whether Start needs a second click: the estimate is above the caps, or a cap is large. `cap`
 * is per run; with several runs the estimate is the sum, so it is held against all their caps.
 */
export function confirmReason(
  cap: number,
  estimateUsd: number | null,
  runs = 1,
): ConfirmReason | null {
  const aboveCap = estimateUsd !== null && estimateUsd > cap * runs;
  const bigCap = cap > CONFIRM_ABOVE_USD;
  return aboveCap || bigCap ? { aboveCap, bigCap } : null;
}

/**
 * One estimate for several runs: costs and volumes added up, the room left taken from the first
 * (every run asks the same server the same question), blockers and assumptions without repeats.
 */
export function combinePreviews(previews: readonly RunPreview[]): RunPreview | null {
  const first = previews[0];
  if (!first) return null;
  if (previews.length === 1) return first;
  const sum = (pick: (p: RunPreview) => number) => previews.reduce((n, p) => n + pick(p), 0);
  const leads = sum((p) => p.volume.leads);
  const total = sum((p) => p.cost.totalUsd);
  const unique = <T>(items: T[], key: (x: T) => string) => [
    ...new Map(items.map((x) => [key(x), x])).values(),
  ];
  return {
    ...first,
    cells: previews.flatMap((p) => p.cells),
    queries: previews
      .flatMap((p) => p.queries.map((q) => ({ ...q, regionId: p.regionId })))
      .slice(0, 50),
    queriesTotal: sum((p) => p.queriesTotal),
    volume: {
      ...first.volume,
      placesMax: sum((p) => p.volume.placesMax),
      places: sum((p) => p.volume.places),
      newPlaces: sum((p) => p.volume.newPlaces),
      qualified: sum((p) => p.volume.qualified),
      people: sum((p) => p.volume.people),
      leads,
    },
    cost: {
      ...first.cost,
      discoverUsd: sum((p) => p.cost.discoverUsd),
      findPeopleUsd: sum((p) => p.cost.findPeopleUsd),
      enrichUsd: sum((p) => p.cost.enrichUsd),
      totalUsd: total,
      perLeadUsd: leads >= 1 ? total / leads : null,
      upperBoundUsd: sum((p) => p.cost.upperBoundUsd),
    },
    blockers: unique(
      previews.flatMap((p) => p.blockers),
      (b) => b.code,
    ),
    assumptions: unique(
      previews.flatMap((p) => p.assumptions),
      (a) => a,
    ),
  };
}

/**
 * How many of the chosen regions a start can begin: one run each, but never more than the free
 * places for concurrent runs. The rest are left for the person to start when a run finishes.
 */
export function runsToStart(
  regions: number,
  limits: { activeRuns: number; maxActiveRuns: number } | null,
): number {
  if (!limits) return regions;
  return Math.max(0, Math.min(regions, limits.maxActiveRuns - limits.activeRuns));
}

/** The toast after a start: one run, several, and any regions that had to wait. */
export function startedMessage(t: Translate, runs: readonly RunSummary[], notStarted: string[]) {
  const names = runs.map((r) => r.region).join(', ');
  const head =
    runs.length === 1
      ? t('create.toast', { region: names })
      : t('create.toast.many', { n: runs.length, regions: names });
  return notStarted.length === 0
    ? head
    : `${head} ${t('create.toast.waiting', { regions: notStarted.join(', ') })}`;
}
