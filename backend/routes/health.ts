import { HEALTH_PROVIDERS, type HealthView, type RunSummary } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { markProviderOk } from '../data/appErrors.js';
import { runSummaries } from '../data/views.js';
import { buildHealth } from '../lib/health.js';
import type { RouteDeps } from './deps.js';
import { notFound, uuidParam } from './http.js';

const ProviderParam = z.object({ provider: z.enum(HEALTH_PROVIDERS) });

export async function healthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, runner } = deps;

  const view = (userId: ReturnType<typeof currentUser>['id']): Promise<HealthView> =>
    buildHealth(db, userId, {
      facts: deps.healthFacts,
      dailyJump: deps.dailyJump,
    });

  // Provider states, the last 20 errors with counts, startup checks and warnings.
  app.get('/api/health', async (request): Promise<HealthView> => view(currentUser(request).id));

  // "I fixed it": puts a provider back to ok after the person topped up or changed the key. The
  // next real call decides again, so a wrong guess shows up as a new failure.
  app.post('/api/health/providers/:provider/reset', async (request): Promise<HealthView> => {
    const user = currentUser(request).id;
    const params = ProviderParam.safeParse(request.params);
    if (!params.success) throw notFound();
    await markProviderOk(db, params.data.provider);
    runner.changes.notify(user);
    return view(user);
  });

  // "Check again": gives a run its next pass now instead of waiting for the poller, then
  // re-reads what the watchdog thinks of it. The same work the poller does, only sooner.
  app.post('/api/runs/:id/recheck', async (request): Promise<RunSummary> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    if ((await runSummaries(db, user, [id])).length === 0) throw notFound();
    await runner.advance(user, id);
    await deps.watchdog.check();
    const [summary] = await runSummaries(db, user, [id]);
    return summary!;
  });
}
