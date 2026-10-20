import type { ApifyLog, ApifyLogRun } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { trustedUserId } from '../data/ids.js';
import {
  activeRunIds,
  apifySteps,
  listRunSummaries,
  recentApifyEvents,
  runSummaries,
} from '../data/views.js';
import { verifyWebhook } from '../runner/webhooks.js';
import type { RouteDeps } from './deps.js';
import { ApiError, PageQuery, query, toPage, UUID } from './http.js';

const LogQuery = PageQuery.extend({
  /** How many recent runs to include besides the active ones. */
  runs: z.coerce.number().int().min(0).max(50).default(10),
});

export async function apifyRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, runner } = deps;

  // The feed behind the Apify log widget: current and recent runs with every Apify run's
  // state history, the runs that restarted or resumed, and the latest state changes.
  app.get('/api/apify/log', async (request): Promise<ApifyLog> => {
    const user = currentUser(request).id;
    const q = query(LogQuery, request);
    const recentRuns = (await listRunSummaries(db, user, { limit: q.runs, offset: 0 })).items;
    const ids = [...new Set([...(await activeRunIds(db, user)), ...recentRuns.map((r) => r.id)])];
    const summaries = await runSummaries(db, user, ids);
    const steps = await apifySteps(db, user, { runIds: ids });

    const isActive = (r: { status: string }) => r.status === 'running' || r.status === 'pending';
    const runs: ApifyLogRun[] = summaries
      .map((run) => ({
        run,
        steps: steps.filter((s) => s.runId === run.id).map(({ runId: _runId, ...step }) => step),
      }))
      .sort(
        (a, b) =>
          Number(!isActive(a.run)) - Number(!isActive(b.run)) ||
          b.run.createdAt.localeCompare(a.run.createdAt),
      );
    const events = await recentApifyEvents(db, user, q);
    return {
      runs,
      attention: (
        await apifySteps(db, user, { inFlightOnly: true, latestStates: ['restarting', 'resumed'] })
      ).map(({ runId: _runId, ...step }) => step),
      recent: toPage(events.items, events.total, q),
    };
  });

  // Called by Apify, not a browser: no session and no CSRF token. The body must carry our
  // signature for one of our steps; anything else is refused before it touches the runner.
  app.post(
    '/api/webhooks/apify',
    { config: { public: true, csrf: false } },
    async (request, reply) => {
      if (!deps.webhookSecret) {
        throw new ApiError(503, 'webhook_disabled', 'No webhook secret is configured');
      }
      const payload = verifyWebhook(deps.webhookSecret, request.body);
      if (!payload) {
        await deps.errors?.message(
          'webhook',
          'invalid_signature',
          'A webhook call arrived with a signature that does not match the webhook secret, and was refused',
        );
        return reply.code(401).send({ error: 'invalid_signature' });
      }
      // Unknown, finished or repeated events are accepted and ignored: Apify retries anything
      // that isn't a 2xx, and applying a result twice is impossible (Orchestrator.applyJob).
      if (!UUID.safeParse(payload.userId).success || !UUID.safeParse(payload.stepId).success) {
        return reply.code(202).send({ accepted: true, known: false });
      }
      const result = await runner.onStepWebhook(trustedUserId(payload.userId), payload.stepId);
      return reply.code(202).send({ accepted: true, known: result !== null });
    },
  );
}
