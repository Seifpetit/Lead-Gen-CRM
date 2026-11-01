import type { MapPins } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { listMapPins } from '../data/mapPins.js';
import type { RouteDeps } from './deps.js';
import { CountryParam, query } from './http.js';

export async function mapRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  // Every company of the signed-in user that has a place, as a pin for the Coverage map.
  app.get('/api/map/pins', async (request): Promise<MapPins> => {
    const { country } = query(z.object({ country: CountryParam }), request);
    return listMapPins(deps.db, currentUser(request).id, country);
  });
}
