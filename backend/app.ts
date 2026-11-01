import Fastify, { type FastifyServerOptions } from 'fastify';
import authPlugin, { currentUser } from './auth/plugin.js';
import type { UserId } from './data/ids.js';
import type { AuthService } from './auth/service.js';
import { DEFAULT_MAX_RUN_CAP_USD } from '@lead-gen-crm/shared';
import type { Db } from './data/db.js';
import csrfPlugin from './routes/csrf.js';
import { ApiError } from './routes/http.js';
import { registerRoutes } from './routes/index.js';
import type { ErrorReporter } from './runner/errorReporter.js';
import {
  DEFAULT_DAILY_JUMP,
  DEFAULT_HEALTH_FACTS,
  type DailyJumpConfig,
  type HealthFacts,
} from './runner/healthView.js';
import type { DevConsole } from './runner/devConsole.js';
import type { Orchestrator } from './runner/orchestrator.js';
import { Watchdog } from './runner/watchdog.js';

/** Never logged, whatever the log level: credentials travel in these. */
export const LOG_REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.inviteCode',
  '*.token',
  '*.signature',
];

export interface RouteInfo {
  method: string;
  url: string;
  public: boolean;
  csrf: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every route registered, for the contract test that checks each one is covered. */
    routeTable: RouteInfo[];
  }
}

export async function buildApp(deps: {
  db: Db;
  auth: AuthService;
  runner: Orchestrator;
  /** Paid runs stay off until the pilot; see routes/deps.ts. */
  paidRunsEnabled?: boolean;
  webhookSecret?: string | null;
  noiseRetentionDays?: number;
  /** Largest spend cap a run may be given (USD); see MAX_RUN_CAP_USD. */
  maxRunCapUsd?: number;
  /** API tokens and the like: hidden from run logs by value, besides the patterns. */
  secrets?: readonly (string | null | undefined)[];
  /** Where failures are noted (see lib/errorReporter.ts). */
  errors?: ErrorReporter | null;
  watchdog?: Watchdog;
  healthFacts?: HealthFacts;
  dailyJump?: DailyJumpConfig;
  /** The developer console (DEV_CONSOLE); left out, its routes do not exist. */
  devConsole?: DevConsole | null;
  logger?: FastifyServerOptions['logger'];
}) {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: false });

  const routeTable: RouteInfo[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routeTable.push({
        method,
        url: route.url,
        public: route.config?.public === true,
        csrf: route.config?.csrf !== false,
      });
    }
  });

  // Handled failures keep their status and code; anything else 5xx is logged and hidden.
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    if (err instanceof ApiError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message, ...err.details });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      // Noted without waiting, and never allowed to fail the answer itself.
      let userId: UserId | null = null;
      try {
        userId = currentUser(request).id;
      } catch {
        // A public route has no user.
      }
      void deps.errors?.error('request', 'unhandled', err, {
        userId,
        step: `${request.method} ${request.routeOptions?.url ?? 'unknown route'}`,
      });
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.code(status).send({ error: 'invalid_request' });
  });

  await app.register(authPlugin, { auth: deps.auth, devConsole: Boolean(deps.devConsole) });
  await app.register(csrfPlugin);
  await registerRoutes(app, {
    db: deps.db,
    runner: deps.runner,
    paidRunsEnabled: deps.paidRunsEnabled ?? false,
    webhookSecret: deps.webhookSecret ?? null,
    noiseRetentionDays: deps.noiseRetentionDays ?? 30,
    maxRunCapUsd: deps.maxRunCapUsd ?? DEFAULT_MAX_RUN_CAP_USD,
    secrets: deps.secrets ?? [],
    errors: deps.errors ?? null,
    watchdog: deps.watchdog ?? new Watchdog({ db: deps.db, changes: deps.runner.changes }),
    healthFacts: deps.healthFacts ?? DEFAULT_HEALTH_FACTS,
    dailyJump: deps.dailyJump ?? DEFAULT_DAILY_JUMP,
    devConsole: deps.devConsole ?? null,
  });
  return app;
}
