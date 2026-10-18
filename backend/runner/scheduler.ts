import { FREIGHT_SECTORS } from '../config/sectors.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { countRuns } from '../data/runs.js';
import { listRegionStats, type CellStats, type RegionStats } from '../data/saturation.js';
import { normalizeQuery } from '../lib/normalize.js';
import type { RunMode } from '@lead-gen-crm/shared';
import type { RunnerConfig } from './config.js';

// Coverage scheduler. Ranks cells (within a region) and regions by leads per dollar, computed
// from cost_ledger and search_queries history. Exploit what pays, explore what is unknown,
// and send one run in `exploreEvery` to the least-covered area.

/** Every French wording the query grid searches. A cell is exhausted when all of them are. */
export const ALL_WORDINGS: readonly string[] = [
  ...new Set(FREIGHT_SECTORS.flatMap((s) => s.searchTermsFr.map((t) => normalizeQuery(t)))),
];

/** Avoids dividing by zero for cells that found leads on free (or not yet settled) spend. */
const MIN_SPEND_USD = 0.01;

export function leadsPerDollar(s: { leads: number; spendUsd: number }): number {
  return s.leads / Math.max(s.spendUsd, MIN_SPEND_USD);
}

/** New places per query: the yield the exhaustion rule watches. */
export function newPlacesPerQuery(s: { newPlacesFound: number; queriesRun: number }): number {
  return s.queriesRun === 0 ? Infinity : s.newPlacesFound / s.queriesRun;
}

export interface CellPlan {
  cellIds: string[];
  /** One line per chosen cell: why it was picked. */
  reasons: string[];
}

/**
 * Picks the cells a run claims.
 *
 * Normal mode: exploit first (cells that produced leads, best leads per dollar, then best
 * new-place yield), then explore (never-searched cells, then the least-searched). One slot is
 * kept for exploring whenever an unexplored cell exists, so a lead-rich region still grows.
 * Exhausted cells and cells claimed by another run are skipped.
 *
 * Maintenance mode: cells not re-searched for maintenanceIntervalDays, oldest first,
 * exhausted or not (only new places go through the paid stages).
 */
export function planRunCells(
  stats: readonly CellStats[],
  config: Pick<RunnerConfig, 'cellsPerRun' | 'maintenanceIntervalDays'>,
  opts: { mode: RunMode; now: Date; explore?: boolean },
): CellPlan {
  const free = stats.filter((c) => c.claimedByRunId === null);
  const n = config.cellsPerRun;
  const plan: CellPlan = { cellIds: [], reasons: [] };
  const take = (c: CellStats, reason: string): void => {
    plan.cellIds.push(c.regionCellId);
    plan.reasons.push(`${c.cellKey}: ${reason}`);
  };

  if (opts.mode === 'maintenance') {
    const dueBefore = opts.now.getTime() - config.maintenanceIntervalDays * 86_400_000;
    const due = free
      .filter((c) => c.lastRunAt === null || c.lastRunAt.getTime() <= dueBefore)
      .sort((a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0));
    for (const c of due.slice(0, n)) {
      take(
        c,
        c.lastRunAt
          ? `maintenance, last searched ${day(c.lastRunAt)}`
          : 'maintenance, never searched',
      );
    }
    return plan;
  }

  const open = free.filter((c) => c.exhaustedAt === null);
  const exploit = open
    .filter((c) => c.leads > 0)
    .sort(
      (a, b) =>
        leadsPerDollar(b) - leadsPerDollar(a) ||
        newPlacesPerQuery(b) - newPlacesPerQuery(a) ||
        a.cellKey.localeCompare(b.cellKey),
    );
  const explore = open
    .filter((c) => c.leads === 0)
    .sort(
      (a, b) =>
        a.queriesRun - b.queriesRun ||
        a.placesFound - b.placesFound ||
        a.cellKey.localeCompare(b.cellKey),
    );

  const exploitSlots = opts.explore ? 0 : explore.length > 0 ? Math.max(n - 1, 0) : n;
  for (const c of exploit.slice(0, exploitSlots)) {
    take(
      c,
      `exploit, ${c.leads} leads for $${c.spendUsd.toFixed(2)} (${leadsPerDollar(c).toFixed(1)} per $)`,
    );
  }
  for (const c of explore) {
    if (plan.cellIds.length >= n) break;
    take(
      c,
      c.queriesRun === 0
        ? 'explore, never searched'
        : `explore, ${c.queriesRun} queries so far, no leads yet`,
    );
  }
  // Explore turn with nothing left to explore: fall back to the best exploit cells.
  for (const c of exploit) {
    if (plan.cellIds.length >= n) break;
    if (!plan.cellIds.includes(c.regionCellId)) take(c, 'exploit, nothing left to explore');
  }
  return plan;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Ways to find more in a saturated region. Suggestions only; nothing is added automatically. */
export function wideningSuggestions(): string[] {
  const english = FREIGHT_SECTORS.flatMap((s) => s.searchTermsEn);
  return [
    `English wordings (not searched by default): ${english.slice(0, 6).join(', ')}${english.length > 6 ? ', ...' : ''}`,
    'Adjacent sectors not in config/sectors.ts yet: cold storage, fishing and seafood processing, paper and printing, electrical equipment, recycling',
    'Arabic wordings: none are configured; add them to config/sectors.ts (needs a native speaker to choose the terms)',
  ];
}

export interface RegionSuggestion {
  /** Null when no region can be run (no bounds anywhere). */
  regionId: string | null;
  mode: RunMode;
  /** Plain-language explanation of the choice. */
  reason: string;
  /** For a saturated region: ways to find more. */
  widening: string[];
  /** Every region considered, with the numbers used. */
  ranking: {
    regionId: string;
    status: RegionStats['mode'];
    leadsPerDollar: number | null;
    coverage: number;
    maintenanceDue: boolean;
  }[];
}

/**
 * Suggests the user's next run and explains why.
 *
 * - Every `exploreEvery`-th run explores: the least-covered active region.
 * - Otherwise exploit: the active region with the best leads per dollar (ledger spend), or the
 *   least-covered one when nothing has produced leads yet.
 * - When every runnable region is saturated: a maintenance run on the one longest without
 *   a run, with widening suggestions.
 */
export async function suggestNextRegion(
  db: Queryable,
  userId: UserId,
  config: Pick<RunnerConfig, 'exploreEvery' | 'maintenanceIntervalDays'>,
  now = new Date(),
): Promise<RegionSuggestion> {
  const regions = (await listRegionStats(db, userId)).filter((r) => r.bounds || r.cellsTotal > 0);
  const runsSoFar = await countRuns(db, userId);
  const dueBefore = now.getTime() - config.maintenanceIntervalDays * 86_400_000;
  const coverage = (r: RegionStats): number =>
    r.cellsTotal === 0 ? 0 : r.cellsSearched / r.cellsTotal;
  const maintenanceDue = (r: RegionStats): boolean =>
    r.mode === 'saturated' && (r.lastRunAt === null || r.lastRunAt.getTime() <= dueBefore);
  const ranking = regions.map((r) => ({
    regionId: r.regionId,
    status: r.mode,
    leadsPerDollar: r.runs === 0 ? null : leadsPerDollar(r),
    coverage: coverage(r),
    maintenanceDue: maintenanceDue(r),
  }));

  if (regions.length === 0) {
    return {
      regionId: null,
      mode: 'normal',
      reason: 'No region has map bounds yet, so none can be searched.',
      widening: [],
      ranking,
    };
  }

  const active = regions.filter((r) => r.mode === 'active');
  const leastCovered = (rs: RegionStats[]): RegionStats =>
    [...rs].sort(
      (a, b) =>
        coverage(a) - coverage(b) || a.runs - b.runs || a.regionId.localeCompare(b.regionId),
    )[0]!;

  if (active.length === 0) {
    const pick = [...regions].sort(
      (a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0),
    )[0]!;
    const due = maintenanceDue(pick);
    return {
      regionId: pick.regionId,
      mode: 'maintenance',
      reason: due
        ? `Every region is saturated. ${pick.name} has gone longest without a run, so a maintenance run re-checks its contacts older than the stale limit and picks up only new places.`
        : `Every region is saturated and none is due for maintenance yet (every ${config.maintenanceIntervalDays} days). ${pick.name} is the next due; widening the search is the better move now.`,
      widening: wideningSuggestions(),
      ranking,
    };
  }

  const nextRun = runsSoFar + 1;
  if (nextRun % config.exploreEvery === 0) {
    const pick = leastCovered(active);
    return {
      regionId: pick.regionId,
      mode: 'normal',
      reason: `Run ${nextRun} is an explore run (one in ${config.exploreEvery}). ${pick.name} is the least covered: ${pick.cellsSearched} of ${pick.cellsTotal || '?'} cells searched.`,
      widening: [],
      ranking,
    };
  }

  const producing = active.filter((r) => r.leads > 0);
  if (producing.length === 0) {
    const pick = leastCovered(active);
    return {
      regionId: pick.regionId,
      mode: 'normal',
      reason: `No region has produced leads yet, so the least-covered one goes first: ${pick.name} (${pick.cellsSearched} of ${pick.cellsTotal || '?'} cells searched).`,
      widening: [],
      ranking,
    };
  }
  const best = [...producing].sort(
    (a, b) => leadsPerDollar(b) - leadsPerDollar(a) || a.regionId.localeCompare(b.regionId),
  )[0]!;
  const saturatedDue = regions.filter(maintenanceDue).map((r) => r.name);
  return {
    regionId: best.regionId,
    mode: 'normal',
    reason:
      `${best.name} has the best yield: ${best.leads} leads for $${best.spendUsd.toFixed(2)} ` +
      `(${leadsPerDollar(best).toFixed(1)} leads per $).` +
      (saturatedDue.length > 0 ? ` Maintenance is also due in: ${saturatedDue.join(', ')}.` : ''),
    widening: [],
    ranking,
  };
}
