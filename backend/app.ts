import Fastify, { type FastifyServerOptions } from 'fastify';
import authPlugin from './auth/plugin.js';
import type { AuthService } from './auth/service.js';
import type { Db } from './data/db.js';
import csrfPlugin from './routes/csrf.js';
import { ApiError } from './routes/http.js';
import { registerRoutes } from './routes/index.js';
import type { Orchestrator } from './runner/orchestrator.js';

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
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.code(status).send({ error: 'invalid_request' });
  });

  await app.register(authPlugin, { auth: deps.auth });
  await app.register(csrfPlugin);
  await registerRoutes(app, {
    db: deps.db,
    runner: deps.runner,
    paidRunsEnabled: deps.paidRunsEnabled ?? false,
    webhookSecret: deps.webhookSecret ?? null,
    noiseRetentionDays: deps.noiseRetentionDays ?? 30,
  });
  return app;
}
