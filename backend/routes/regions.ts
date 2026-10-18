import type {
  CellDetail,
  CellSummary,
  Page,
  RegionSuggestionView,
  RegionSummary,
} from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';
import { listCoverage } from '../data/regionCoverage.js';
import { listRegions } from '../data/regions.js';
import { listCellStats, listExhaustedQueries, listRegionStats } from '../data/saturation.js';
import { cellQueries, regionQueryTotals } from '../data/views.js';
import { suggestNextRegion } from '../runner/scheduler.js';
import type { RouteDeps } from './deps.js';
import { notFound, PageQuery, query, toPage, uuidParam } from './http.js';

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function regionRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, runner } = deps;

  async function requireRegion(regionId: string) {
    const region = (await listRegions(db)).find((r) => r.id === regionId);
    if (!region) throw notFound('unknown_region');
    return region;
  }

  app.get('/api/regions', async (request): Promise<Page<RegionSummary>> => {
    const user = currentUser(request).id;
    const page = query(PageQuery, request);
    const [stats, coverage, totals] = await Promise.all([
      listRegionStats(db, user),
      listCoverage(db, user),
      regionQueryTotals(db, user),
    ]);
    const all: RegionSummary[] = stats.map((s) => {
      const c = coverage.find((x) => x.regionId === s.regionId);
      const t = totals.get(s.regionId);
      return {
        regionId: s.regionId,
        name: s.name,
        hasBounds: s.bounds !== null,
        status: s.mode,
        saturatedAt: iso(s.saturatedAt),
        cellsTotal: s.cellsTotal,
        cellsSearched: s.cellsSearched,
        cellsExhausted: s.cellsExhausted,
        coverage: s.cellsTotal > 0 ? s.cellsSearched / s.cellsTotal : null,
        queriesRun: t?.queries ?? 0,
        placesFound: t?.places ?? 0,
        newPlacesPerQuery: t && t.queries > 0 ? t.newPlaces / t.queries : null,
        qualifiedShare: c?.qualifiedShare ?? null,
        decisionMakerShare: c?.decisionMakerShare ?? null,
        channelShare: c?.channelShare ?? null,
        spendUsd: s.spendUsd,
        leads: s.leads,
        costPerLeadUsd: s.leads > 0 ? s.spendUsd / s.leads : null,
        runs: s.runs,
        lastRunAt: iso(s.lastRunAt),
      };
    });
    return toPage(all.slice(page.offset, page.offset + page.limit), all.length, page);
  });

  app.get('/api/regions/suggestion', async (request): Promise<RegionSuggestionView> => {
    return suggestNextRegion(db, currentUser(request).id, runner.config);
  });

  app.get<{ Params: { regionId: string } }>(
    '/api/regions/:regionId/cells',
    async (request): Promise<Page<CellSummary>> => {
      const user = currentUser(request).id;
      await requireRegion(request.params.regionId);
      const page = query(PageQuery, request);
      const cells = await listCellStats(db, user, request.params.regionId);
      return toPage(
        cells.slice(page.offset, page.offset + page.limit).map(cellSummary),
        cells.length,
        page,
      );
    },
  );

  app.get<{ Params: { regionId: string; cellId: string } }>(
    '/api/regions/:regionId/cells/:cellId',
    async (request): Promise<CellDetail> => {
      const user = currentUser(request).id;
      const { regionId } = request.params;
      await requireRegion(regionId);
      const cellId = uuidParam(request, 'cellId');
      const cell = (await listCellStats(db, user, regionId)).find((c) => c.regionCellId === cellId);
      if (!cell) throw notFound();
      const exhausted = await listExhaustedQueries(db, user, regionId);
      return {
        ...cellSummary(cell),
        exhaustedWordings: exhausted
          .filter((e) => e.regionCellId === cellId)
          .map((e) => e.normalizedQuery),
        queries: await cellQueries(db, user, cellId),
      };
    },
  );
}

function cellSummary(c: Awaited<ReturnType<typeof listCellStats>>[number]): CellSummary {
  return {
    regionCellId: c.regionCellId,
    cellKey: c.cellKey,
    bounds: c.bounds,
    spendUsd: c.spendUsd,
    leads: c.leads,
    queriesRun: c.queriesRun,
    placesFound: c.placesFound,
    newPlacesFound: c.newPlacesFound,
    lastRunAt: iso(c.lastRunAt),
    exhaustedAt: iso(c.exhaustedAt),
    claimedByRunId: c.claimedByRunId,
  };
}
