import type { LiveRuns, RunLogPage } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { listRunLog } from '../data/runLog.js';
import { activeRunSummaries, recentlyEndedRunSummaries, runSummaries } from '../data/views.js';
import type { RouteDeps } from './deps.js';
import { notFound, query, uuidParam } from './http.js';

/** How often the stream re-reads while nothing nudges it (steps land by webhook or by polling). */
export const STREAM_TICK_MS = 2_000;
/** A comment line now and then keeps proxies from closing a quiet connection. */
export const STREAM_HEARTBEAT_MS = 15_000;
/** The stream ends after this long and the browser reconnects, which checks the session again. */
export const STREAM_MAX_MS = 30 * 60_000;
/** Changes that arrive together are sent as one update. */
const STREAM_DEBOUNCE_MS = 150;

const LogQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export async function runLiveRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, runner } = deps;

  // The runs in progress: what the stream sends, for a client that cannot use the stream.
  app.get('/api/runs/live', async (request): Promise<LiveRuns> => {
    const user = currentUser(request).id;
    return {
      runs: await activeRunSummaries(db, user),
      ended: await recentlyEndedRunSummaries(db, user, new Date()),
    };
  });

  // Server-Sent Events: the same payload, pushed whenever something about the user's runs
  // changes. Per user (the session decides whose runs), with a heartbeat. A client that
  // cannot keep it open falls back to GET /api/runs/live every few seconds.
  app.get('/api/runs/stream', async (request, reply) => {
    const user = currentUser(request).id;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 3000\n\n');

    let closed = false;
    let busy = false;
    let again = false;
    let last = '';
    const push = async (): Promise<void> => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const data = JSON.stringify({
          runs: await activeRunSummaries(db, user),
          ended: await recentlyEndedRunSummaries(db, user, new Date()),
        } satisfies LiveRuns);
        // Only a change is worth an event; the heartbeat covers the quiet.
        if (!closed && data !== last) {
          last = data;
          raw.write(`event: runs\ndata: ${data}\n\n`);
        }
      } catch (err) {
        request.log.error({ err }, 'live runs update failed');
      } finally {
        busy = false;
        if (again) {
          again = false;
          void push();
        }
      }
    };

    let nudge: NodeJS.Timeout | null = null;
    const unsubscribe = runner.changes.subscribe(user, () => {
      nudge ??= setTimeout(() => {
        nudge = null;
        void push();
      }, STREAM_DEBOUNCE_MS);
    });
    const tick = setInterval(() => void push(), STREAM_TICK_MS);
    const beat = setInterval(() => {
      if (!closed) raw.write(': ping\n\n');
    }, STREAM_HEARTBEAT_MS);
    const limit = setTimeout(() => raw.end(), STREAM_MAX_MS);
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(tick);
      clearInterval(beat);
      clearTimeout(limit);
      if (nudge) clearTimeout(nudge);
    };
    raw.on('close', close);
    raw.on('error', close);
    await push();
    return reply;
  });

  // Every line of one run's log, oldest first. `after` is the last id seen, so a client that
  // keeps asking gets only what is new.
  app.get('/api/runs/:id/logs', async (request): Promise<RunLogPage> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    if ((await runSummaries(db, user, [id])).length === 0) throw notFound();
    const q = query(LogQuery, request);
    return listRunLog(db, user, id, {
      after: q.after,
      limit: q.limit,
      secrets: deps.secrets,
    });
  });
}
