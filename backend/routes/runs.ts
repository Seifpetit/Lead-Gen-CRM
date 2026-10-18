import type { Page, RunDetail, RunPreview, RunSummary, StartBlocker } from '@lead-gen-crm/shared';
import { RUN_MODES, RUN_STATUSES } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import { listRegions } from '../data/regions.js';
import { RunLimitError } from '../data/runs.js';
import {
  listLeadIds,
  listRunSummaries,
  loadLeads,
  runStepCounts,
  runSummaries,
} from '../data/views.js';
import { RunStartError } from '../runner/orchestrator.js';
import { cleanWordings, MAX_CUSTOM_WORDINGS, MAX_WORDING_CHARS } from '../stages/queryGrid.js';
import type { RouteDeps } from './deps.js';
import { ApiError, body, csvList, notFound, PageQuery, query, toPage, uuidParam } from './http.js';

/** The most a single run may be allowed to spend; a typo guard, not a budget. */
export const MAX_RUN_CAP_USD = 10_000;

/** Most cells a run can be restricted to. */
const MAX_CELL_KEYS = 100;

const SECTOR_IDS = FREIGHT_SECTORS.map((s) => s.id) as [string, ...string[]];

// The search plan: what to search beyond the region. All of it is optional.
const Wording = z
  .string()
  .transform((w) =>
    w
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().min(1).max(MAX_WORDING_CHARS));
const PlanFields = {
  regionId: z.string().min(1).max(60),
  sectorIds: z.array(z.enum(SECTOR_IDS)).max(SECTOR_IDS.length).optional(),
  customWordings: z.array(Wording).max(MAX_CUSTOM_WORDINGS).optional(),
  cellKeys: z.array(z.string().min(1).max(100)).max(MAX_CELL_KEYS).optional(),
  mode: z.enum(RUN_MODES).optional(),
};

/** No sectors and no wordings would search nothing. */
function nonEmptyPlan(v: {
  sectorIds?: string[] | undefined;
  customWordings?: string[] | undefined;
}) {
  return !(v.sectorIds?.length === 0 && (v.customWordings?.length ?? 0) === 0);
}
const EMPTY_PLAN = { message: 'Pick a sector or add a wording', path: ['sectorIds'] };

const PreviewBody = z
  .object({ ...PlanFields, budgetCapUsd: z.number().positive().max(MAX_RUN_CAP_USD).optional() })
  .strict()
  .refine(nonEmptyPlan, EMPTY_PLAN);

const StartBody = z
  .object({
    ...PlanFields,
    budgetCapUsd: z.number().positive().max(MAX_RUN_CAP_USD),
    confirm: z.literal(true),
  })
  .strict()
  .refine(nonEmptyPlan, EMPTY_PLAN);

const ListQuery = PageQuery.extend({ status: csvList(z.enum(RUN_STATUSES)) });

/** Drops duplicate wordings (accents and case ignored), keeping the first as typed. */
function tidy<T extends { customWordings?: string[] | undefined }>(input: T): T {
  return input.customWordings
    ? { ...input, customWordings: cleanWordings(input.customWordings) }
    : input;
}

/** Input types without exactOptionalPropertyTypes noise: drop undefined keys. */
function defined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

async function requireRegion(deps: RouteDeps, regionId: string): Promise<void> {
  if (!(await listRegions(deps.db)).some((r) => r.id === regionId)) {
    throw new ApiError(404, 'unknown_region');
  }
}

function blocked(blockers: StartBlocker[]): ApiError {
  const first = blockers[0]!;
  return new ApiError(first.code === 'no_bounds' ? 422 : 409, first.code, first.message, {
    blockers,
  });
}

export async function runRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, runner } = deps;

  // Estimated volume and cost. Reads history and price tables only: nothing is started,
  // written or spent, so it is safe to call as often as the form changes.
  app.post('/api/runs/preview', async (request): Promise<RunPreview> => {
    const input = body(PreviewBody, request);
    await requireRegion(deps, input.regionId);
    return runner.preview(currentUser(request).id, defined(tidy(input)));
  });

  app.post('/api/runs', async (request, reply): Promise<RunSummary> => {
    const input = body(StartBody, request);
    const user = currentUser(request).id;
    if (!deps.paidRunsEnabled) {
      throw new ApiError(
        403,
        'paid_runs_disabled',
        'Paid runs are switched off until the pilot; previews and reads still work',
      );
    }
    await requireRegion(deps, input.regionId);
    const { confirm: _confirm, ...start } = tidy(input);

    const preview = await runner.preview(user, defined(start));
    if (preview.blockers.length > 0) throw blocked(preview.blockers);
    try {
      const run = await runner.startRun(user, defined(start));
      const [summary] = await runSummaries(db, user, [run.id]);
      return reply.code(201).send(summary);
    } catch (err) {
      // The preview is advisory; these are the authoritative checks, atomic at start.
      if (err instanceof RunLimitError) {
        throw new ApiError(409, 'concurrent_run_limit', err.message);
      }
      if (err instanceof RunStartError) {
        throw new ApiError(err.code === 'no_bounds' ? 422 : 409, err.code, err.message);
      }
      throw err;
    }
  });

  app.get('/api/runs', async (request): Promise<Page<RunSummary>> => {
    const q = query(ListQuery, request);
    const { items, total } = await listRunSummaries(
      db,
      currentUser(request).id,
      q,
      q.status ? { status: q.status } : {},
    );
    return toPage(items, total, q);
  });

  app.get('/api/runs/:id', async (request): Promise<RunDetail> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const [summary] = await runSummaries(db, user, [id]);
    if (!summary) throw notFound();
    const { ids, total } = await listLeadIds(db, user, { runId: id }, { limit: 50, offset: 0 });
    return {
      ...summary,
      steps: await runStepCounts(db, user, id),
      leads: await loadLeads(db, user, ids),
      leadsTotal: total,
    };
  });

  app.post('/api/runs/:id/stop', async (request): Promise<RunSummary> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const stopped = await runner.stopRun(user, id);
    if (!stopped) throw notFound();
    if (!stopped.stopped) {
      throw new ApiError(409, 'run_not_active', `The run is already ${stopped.run.status}`);
    }
    return (await runSummaries(db, user, [id]))[0]!;
  });
}
