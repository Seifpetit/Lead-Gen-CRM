import type {
  DevClassifyInput,
  DevDiscoverInput,
  DevEstimate,
  DevHistoryEntry,
  DevOptions,
  DevStep,
} from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { isDevAdminEmail } from '../auth/service.js';
import {
  ClassifyBody,
  DevConsoleError,
  DiscoverBody,
  StepParam,
  type DevConsole,
} from '../runner/devConsole.js';
import type { RouteDeps } from './deps.js';
import { ApiError, body, notFound, query, uuidParam } from './http.js';

// The developer console's API. Registered only when DEV_CONSOLE is on, and even then it answers
// 404 to everybody but the dev admin, so a normal user cannot tell it is there.

const StepBody = z.discriminatedUnion('step', [
  z.object({ step: z.literal('discover'), input: DiscoverBody }).strict(),
  z.object({ step: z.literal('classify'), input: ClassifyBody }).strict(),
]);
const HistoryQuery = z.object({ step: StepParam.optional() });

/** A refusal from the console becomes the same plain answer every other route gives. */
async function plain<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof DevConsoleError) throw new ApiError(err.status, err.code, err.message);
    throw err;
  }
}

export async function devConsoleRoutes(
  app: FastifyInstance,
  deps: RouteDeps & { devConsole: DevConsole },
): Promise<void> {
  const consoleService = deps.devConsole;
  app.addHook('preHandler', async (request) => {
    if (!isDevAdminEmail(currentUser(request).email)) throw notFound();
  });

  app.get('/api/dev/console/options', async (): Promise<DevOptions> => consoleService.options());

  app.post('/api/dev/console/estimate', async (request): Promise<DevEstimate> => {
    const { step, input } = body(StepBody, request);
    return plain(() =>
      consoleService.estimate(
        currentUser(request).id,
        step,
        input as DevDiscoverInput | DevClassifyInput,
      ),
    );
  });

  // Starts the call and answers at once; the page looks at the history entry until it ends.
  app.post('/api/dev/console/run', async (request, reply): Promise<DevHistoryEntry> => {
    const { step, input } = body(StepBody, request);
    const entry = await plain(() =>
      consoleService.start(
        currentUser(request).id,
        step,
        input as DevDiscoverInput | DevClassifyInput,
      ),
    );
    return reply.code(202).send(entry);
  });

  app.get('/api/dev/console/history', async (request): Promise<{ items: DevHistoryEntry[] }> => {
    const { step } = query(HistoryQuery, request);
    return { items: await consoleService.history(currentUser(request).id, step ?? null) };
  });

  app.get('/api/dev/console/history/:id', async (request): Promise<DevHistoryEntry> => {
    const entry = await consoleService.entry(currentUser(request).id, uuidParam(request, 'id'));
    if (!entry) throw notFound();
    return entry;
  });

  app.delete('/api/dev/console/history', async (request, reply) => {
    const { step } = query(HistoryQuery, request);
    await consoleService.clear(currentUser(request).id, (step ?? null) as DevStep | null);
    return reply.code(204).send();
  });
}
