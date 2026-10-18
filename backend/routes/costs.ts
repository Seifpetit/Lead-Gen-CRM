import type { BudgetView, CostRow, Page, RunCostsView } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { monthOf } from '../data/costLedger.js';
import { getRun } from '../data/runs.js';
import { getMonthlyBudget, setMonthlyCap } from '../data/userBudget.js';
import { costsBy, ledgerPage } from '../data/views.js';
import { reconcileRun } from '../runner/reconcile.js';
import type { RouteDeps } from './deps.js';
import { body, notFound, PageQuery, query, toPage, uuidParam } from './http.js';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const monthStart = (m: string) => new Date(`${m}-01T00:00:00Z`);

const CostQuery = PageQuery.extend({
  groupBy: z.enum(['run', 'region', 'provider', 'month']).default('month'),
  month: Month.optional(),
});
const BudgetQuery = z.object({ month: Month.optional() });
const SetCapBody = z
  .object({ capUsd: z.number().positive().max(1_000_000), month: Month.optional() })
  .strict();

export async function costRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;

  async function budget(
    user: ReturnType<typeof currentUser>['id'],
    month?: string,
  ): Promise<BudgetView> {
    const b = await getMonthlyBudget(db, user, month ? monthStart(month) : new Date());
    return {
      month: b.month.toISOString().slice(0, 10),
      capUsd: b.capUsd,
      spentUsd: b.spentUsd,
      remainingUsd: b.capUsd === null ? null : Math.max(0, b.capUsd - b.spentUsd),
    };
  }

  // Read-only views over the cost ledger: totals by run, region, provider or month.
  app.get('/api/costs', async (request): Promise<Page<CostRow>> => {
    const q = query(CostQuery, request);
    const { items, total } = await costsBy(
      db,
      currentUser(request).id,
      q.groupBy,
      q.month ? { month: monthStart(q.month) } : {},
      q,
    );
    return toPage(items, total, q);
  });

  app.get('/api/costs/budget', async (request): Promise<BudgetView> => {
    return budget(currentUser(request).id, query(BudgetQuery, request).month);
  });

  // Sets the month's cap. Lowering it below what is already spent is allowed: it simply stops
  // further spend this month.
  app.put('/api/costs/budget', async (request): Promise<BudgetView> => {
    const user = currentUser(request).id;
    const input = body(SetCapBody, request);
    await setMonthlyCap(
      db,
      user,
      input.month ? monthStart(input.month) : monthOf(new Date()),
      input.capUsd,
    );
    return budget(user, input.month);
  });

  // One run's ledger, with estimate vs actual per step.
  app.get('/api/runs/:id/costs', async (request): Promise<RunCostsView> => {
    const user = currentUser(request).id;
    const runId = uuidParam(request, 'id');
    if (!(await getRun(db, user, runId))) throw notFound();
    const page = query(PageQuery, request);
    const [rec, entries] = await Promise.all([
      reconcileRun(db, user, runId),
      ledgerPage(db, user, runId, page),
    ]);
    return {
      runId,
      entries: toPage(entries.items, entries.total, page),
      estimatedUsd: rec.estimatedUsd,
      actualUsd: rec.actualUsd,
      ledgerUsd: rec.ledgerUsd,
      unsettledEstimateUsd: rec.unsettledEstimateUsd,
      flagged: rec.flagged,
    };
  });
}
