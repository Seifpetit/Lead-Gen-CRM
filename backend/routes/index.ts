import type { FastifyInstance } from 'fastify';
import { apifyRoutes } from './apify.js';
import { crmRoutes } from './crm.js';
import { costRoutes } from './costs.js';
import { coverageRoutes } from './coverage.js';
import { exportRoutes } from './exports.js';
import type { RouteDeps } from './deps.js';
import { leadRoutes } from './leads.js';
import { messageRoutes } from './messages.js';
import { regionRoutes } from './regions.js';
import { runLiveRoutes } from './runLive.js';
import { runRoutes } from './runs.js';

export type { RouteDeps };

/** Every API route except auth (backend/auth/plugin.ts). Thin: handlers call the runner and data layer. */
export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(runLiveRoutes, deps);
  await app.register(runRoutes, deps);
  await app.register(regionRoutes, deps);
  await app.register(coverageRoutes, deps);
  await app.register(leadRoutes, deps);
  await app.register(crmRoutes, deps);
  await app.register(costRoutes, deps);
  await app.register(apifyRoutes, deps);
  await app.register(exportRoutes, deps);
  await app.register(messageRoutes, deps);
}
