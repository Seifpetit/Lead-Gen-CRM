import type { Coverage } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';
import { buildCoverage } from '../runner/coverage.js';
import type { RouteDeps } from './deps.js';

export async function coverageRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  // Per region and sector: queries run, new places, leads, spend, cost per lead and a state.
  // Read-only, and scoped to the signed-in user's own history and ledger.
  app.get('/api/coverage', async (request): Promise<Coverage> => {
    return buildCoverage(deps.db, currentUser(request).id);
  });
}
