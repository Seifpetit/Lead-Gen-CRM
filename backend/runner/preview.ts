import type {
  PlannedQuery,
  RunMode,
  RunPreview,
  RunPreviewInput,
  StartBlocker,
} from '@lead-gen-crm/shared';
import { APIFY_MIN_MAX_CHARGE_USD } from '../config/pricing.js';
import { listCompaniesWithStaleContacts } from '../data/contacts.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { cellsInOutline, listCells } from '../data/regionCells.js';
import { listCoverage } from '../data/regionCoverage.js';
import { getRegionBounds, getRegionOutline } from '../data/regions.js';
import { countActiveRuns, countRuns } from '../data/runs.js';
import { listCellStats, listExhaustedQueries, type CellStats } from '../data/saturation.js';
import { getMonthlyBudget } from '../data/userBudget.js';
import { cellOverlap, splitBounds } from '../lib/geo.js';
import type { CompanyDiscovery, EmailFinder, PeopleFinder } from '../providers/types.js';
import { buildQueryGrid, gridShape } from '../stages/queryGrid.js';
import type { RunnerConfig } from './config.js';
import { sumUsd } from './costs.js';
import { titleKeywords } from './keywords.js';
import {
  gridSectorIds,
  PLANNED_QUERIES_SHOWN,
  plannedQuery,
  sectorList,
  usableCells,
} from './plan.js';
import { planRunCells } from './scheduler.js';

// A run's estimated volume and cost, computed without starting or spending anything: it
// reads history and calls the providers' estimate() (a price table), never their run methods.

/** The plan's funnel (2,500 places, 300 companies, 150 people, 100 leads) until history exists. */
export const PLAN_FUNNEL = {
  qualifiedShare: 300 / 2500,
  peoplePerQualified: 150 / 300,
  leadsPerPerson: 100 / 150,
} as const;

/** Enough history to trust over the plan's numbers. */
const MIN_PLACES_FOR_HISTORY = 50;
const MIN_QUALIFIED_FOR_HISTORY = 20;

export interface PreviewContext {
  db: Queryable;
  discovery: CompanyDiscovery;
  people: PeopleFinder;
  emails: EmailFinder;
  config: RunnerConfig;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const round = (n: number) => Math.round(n);

export async function previewRun(
  ctx: PreviewContext,
  userId: UserId,
  input: RunPreviewInput,
  now = new Date(),
): Promise<RunPreview> {
  const { db, config } = ctx;
  const mode: RunMode = input.mode ?? 'normal';
  const blockers: StartBlocker[] = [];
  const assumptions: string[] = [];

  // Limits first: they decide whether a start would be accepted.
  const month = await getMonthlyBudget(db, userId, now);
  const monthRemaining = month.capUsd === null ? null : Math.max(0, month.capUsd - month.spentUsd);
  const activeRuns = await countActiveRuns(db, userId);
  if (month.capUsd !== null && month.spentUsd >= month.capUsd) {
    blockers.push({
      code: 'monthly_cap_reached',
      message: `Monthly cap reached: $${month.spentUsd.toFixed(2)} of $${month.capUsd.toFixed(2)} spent`,
    });
  } else if (
    input.budgetCapUsd !== undefined &&
    monthRemaining !== null &&
    input.budgetCapUsd > monthRemaining
  ) {
    blockers.push({
      code: 'cap_exceeds_month_remaining',
      message: `A $${input.budgetCapUsd.toFixed(2)} run cap could break the monthly cap: $${monthRemaining.toFixed(2)} remains this month`,
    });
  }
  if (activeRuns >= config.maxConcurrentRunsPerUser) {
    blockers.push({
      code: 'concurrent_run_limit',
      message: `${activeRuns} runs are already active (limit ${config.maxConcurrentRunsPerUser})`,
    });
  }
  const discoveryMin = APIFY_MIN_MAX_CHARGE_USD[ctx.discovery.name] ?? 0;
  if (input.budgetCapUsd !== undefined && input.budgetCapUsd < discoveryMin) {
    blockers.push({
      code: 'budget_below_minimum',
      message: `The discovery Actor needs a max cost of at least $${discoveryMin.toFixed(2)}; the cap is $${input.budgetCapUsd.toFixed(2)}`,
    });
  }

  // Cells the run would claim.
  const bounds = await getRegionBounds(db, input.regionId);
  const outline = await getRegionOutline(db, input.regionId);
  const stored = await listCells(db, input.regionId, { leafOnly: true });
  let stats: CellStats[];
  if (stored.length > 0) {
    stats = await listCellStats(db, userId, input.regionId);
  } else if (bounds) {
    // Not built yet: starting the run would build this grid. Nothing is written here.
    const { rows, cols } = gridShape(bounds, config.cellsPerRun * 4);
    stats = cellsInOutline(splitBounds(bounds, rows, cols), outline).map((c) => ({
      regionCellId: c.key,
      cellKey: c.key,
      bounds: c.bounds,
      spendUsd: 0,
      leads: 0,
      queriesRun: 0,
      placesFound: 0,
      newPlacesFound: 0,
      lastRunAt: null,
      exhaustedAt: null,
      claimedByRunId: null,
    }));
  } else {
    blockers.push({
      code: 'no_bounds',
      message: `Region ${input.regionId} has no map bounds yet`,
    });
    stats = [];
  }
  const hadCells = stats.length > 0;
  if (input.cellKeys && input.cellKeys.length > 0) {
    const wanted = new Set(input.cellKeys);
    stats = stats.filter((c) => wanted.has(c.cellKey));
  }
  // The run's own start counts as one more run for the explore rotation.
  const explore = ((await countRuns(db, userId)) + 1) % config.exploreEvery === 0;
  // The same rule the run applies: cells with real area inside the region, most inside first.
  const usable = usableCells(stats, outline);
  stats = usable.cells;
  const plan = planRunCells(stats, config, { mode, now, explore, overlap: usable.overlap });
  if (hadCells && plan.cellIds.length === 0) {
    blockers.push({
      code: 'no_free_cells',
      message:
        mode === 'maintenance'
          ? 'No cell is due for a maintenance re-run yet'
          : 'No free cells to search in this region (all exhausted or claimed by another run)',
    });
  }
  const chosen = stats.filter((c) => plan.cellIds.includes(c.regionCellId));

  // Queries those cells would produce.
  const sectorIds = gridSectorIds({
    ...(input.sectorIds ? { sectors: input.sectorIds } : {}),
    customOnly: input.sectorIds !== undefined && input.sectorIds.length === 0,
  });
  let queries = 0;
  const planned: PlannedQuery[] = [];
  let upperBoundDiscoverUsd = 0;
  let maxPlaces = 0;
  if (chosen.length > 0 && bounds) {
    const exhausted =
      mode === 'maintenance' ? [] : await listExhaustedQueries(db, userId, input.regionId);
    const keyById = new Map(stats.map((c) => [c.regionCellId, c.cellKey]));
    const grid = buildQueryGrid({
      regionId: input.regionId,
      bounds,
      cells: chosen.map((c) => ({
        key: c.cellKey,
        bounds: c.bounds,
        ...(outline ? { overlap: cellOverlap(c.bounds, outline) } : {}),
      })),
      ...(sectorIds ? { sectorIds } : {}),
      ...(input.customWordings ? { customWordings: input.customWordings } : {}),
      exhaustedWordings: exhausted.map((e) => ({
        cellKey: keyById.get(e.regionCellId) ?? null,
        normalizedQuery: e.normalizedQuery,
      })),
      maxPlacesPerQuery: config.maxPlacesPerQuery,
    });
    queries = grid.queries.length;
    planned.push(...grid.queries.slice(0, PLANNED_QUERIES_SHOWN).map(plannedQuery));
    for (const q of grid.queries) {
      upperBoundDiscoverUsd += sumUsd(ctx.discovery.estimate(q));
      maxPlaces += q.maxPlaces;
    }
  }

  // History decides the funnel when there is enough of it.
  const coverage = (await listCoverage(db, userId)).find((c) => c.regionId === input.regionId);
  const qualifiedShare =
    coverage && coverage.placesFound >= MIN_PLACES_FOR_HISTORY && coverage.qualifiedShare !== null
      ? coverage.qualifiedShare
      : PLAN_FUNNEL.qualifiedShare;
  const peoplePerQualified =
    coverage &&
    coverage.qualifiedCompanies >= MIN_QUALIFIED_FOR_HISTORY &&
    coverage.decisionMakerShare !== null
      ? coverage.decisionMakerShare
      : PLAN_FUNNEL.peoplePerQualified;
  const hist = await db.query<{ queries: number; results: number; fresh: number }>(
    `SELECT count(*)::integer AS queries, COALESCE(sum(results_returned), 0)::integer AS results,
            COALESCE(sum(new_places_found), 0)::integer AS fresh
       FROM search_queries s JOIN region_cells rc ON rc.id = s.region_cell_id
      WHERE s.user_id = $1 AND rc.region_id = $2`,
    [userId, input.regionId],
  );
  const h = hist.rows[0]!;
  const avgResults = h.queries >= 10 ? h.results / h.queries : config.maxPlacesPerQuery / 2;
  const newShare = h.results >= MIN_PLACES_FOR_HISTORY ? h.fresh / h.results : 1;
  assumptions.push(
    h.queries >= 10
      ? `Each query returns about ${avgResults.toFixed(1)} places, from ${h.queries} earlier queries in this region`
      : `Each query returns about half its maximum of ${config.maxPlacesPerQuery} places (no history yet)`,
    h.results >= MIN_PLACES_FOR_HISTORY
      ? `${(newShare * 100).toFixed(0)}% of places are new, from history`
      : 'All places are new to you (no history yet)',
    coverage && coverage.placesFound >= MIN_PLACES_FOR_HISTORY
      ? `${(qualifiedShare * 100).toFixed(0)}% of places qualify, from history`
      : `12% of new places qualify (the plan's 300 of 2,500)`,
    `${peoplePerQualified.toFixed(2)} decision-makers per qualified company${
      coverage && coverage.qualifiedCompanies >= MIN_QUALIFIED_FOR_HISTORY
        ? ', from history'
        : " (the plan's 150 of 300)"
    }`,
    `${(PLAN_FUNNEL.leadsPerPerson * 100).toFixed(0)}% of decision-makers become leads (the plan's 100 of 150)`,
    'Discovery cost is priced at the Actor price table for the places expected; the upper bound assumes every query returns its maximum',
    'Only companies new to you go through the paid people and email stages',
  );

  const places = queries * avgResults;
  const newPlaces = places * newShare;
  let qualified = newPlaces * qualifiedShare;
  if (mode === 'maintenance') {
    const olderThan = new Date(now.getTime() - config.staleContactDays * 86_400_000);
    const stale = (await listCompaniesWithStaleContacts(db, userId, input.regionId, olderThan))
      .length;
    qualified += stale;
    assumptions.push(
      `${stale} companies with contacts older than ${config.staleContactDays} days are re-checked`,
    );
  }
  const people = qualified * peoplePerQualified;
  const leads = people * PLAN_FUNNEL.leadsPerPerson;

  const discoverUsd = maxPlaces > 0 ? upperBoundDiscoverUsd * (places / maxPlaces) : 0;
  const repPeople = ctx.people.estimate({
    companyName: 'Example',
    companyLinkedinUrl: 'https://www.linkedin.com/company/example',
    titleKeywords: titleKeywords(),
    location: 'Tunisia',
    maxPeople: config.maxPeoplePerCompany,
  });
  const findPeopleUsd = qualified * sumUsd(repPeople);
  const enrichUsd =
    people * sumUsd(ctx.emails.estimate([{ firstName: 'a', lastName: 'b', domain: 'example.tn' }]));
  assumptions.push(
    `People search is priced at the maximum of ${config.maxPeoplePerCompany} profiles per company, so it is an upper bound`,
  );
  const totalUsd = discoverUsd + findPeopleUsd + enrichUsd;

  return {
    regionId: input.regionId,
    mode,
    cells: chosen.map((c, i) => ({ cellKey: c.cellKey, reason: plan.reasons[i] ?? '' })),
    queries: planned,
    queriesTotal: queries,
    sectors: sectorList(),
    volume: {
      placesMax: maxPlaces,
      places: round(places),
      newPlaces: round(newPlaces),
      qualified: round(qualified),
      people: round(people),
      leads: round(leads),
      kind: 'estimate',
    },
    cost: {
      discoverUsd: round6(discoverUsd),
      findPeopleUsd: round6(findPeopleUsd),
      enrichUsd: round6(enrichUsd),
      totalUsd: round6(totalUsd),
      perLeadUsd: leads >= 0.5 ? round6(totalUsd / leads) : null,
      upperBoundUsd: round6(upperBoundDiscoverUsd),
      kind: 'estimate',
    },
    limits: {
      budgetCapUsd: input.budgetCapUsd ?? null,
      monthCapUsd: month.capUsd,
      monthSpentUsd: round6(month.spentUsd),
      monthRemainingUsd: monthRemaining === null ? null : round6(monthRemaining),
      activeRuns,
      maxActiveRuns: config.maxConcurrentRunsPerUser,
    },
    blockers,
    assumptions,
  };
}
