import Fastify, { type FastifyServerOptions } from 'fastify';
import authPlugin from './auth/plugin.js';
import type { AuthService } from './auth/service.js';
import type { Db } from './data/db.js';
import { recordRoutes } from './routes/records.js';

/** Never logged, whatever the log level: credentials travel in these. */
export const LOG_REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.inviteCode',
  '*.token',
];

export async function buildApp(deps: {
  db: Db;
  auth: AuthService;
  logger?: FastifyServerOptions['logger'];
}) {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: false });

  // Don't leak internals in 5xx responses; Fastify still logs the error (without credentials).
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.code(status).send({ error: 'invalid_request' });
  });

  await app.register(authPlugin, { auth: deps.auth });
  await app.register(recordRoutes, { db: deps.db });
  return app;
}
