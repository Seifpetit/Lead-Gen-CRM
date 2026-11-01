import type { CountryInfo } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { COUNTRY_CODES, COUNTRIES } from '../config/countries.js';
import type { RouteDeps } from './deps.js';

export async function countryRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  // The countries the app knows, whether each can start runs, and why not. Reference data, the
  // same for everyone; only the region count is read from the database.
  app.get('/api/countries', async (): Promise<{ items: CountryInfo[] }> => {
    const { rows } = await deps.db.query<{ country: string; n: number }>(
      'SELECT country, count(*)::integer AS n FROM regions GROUP BY country',
    );
    const regions = new Map(rows.map((r) => [r.country, r.n]));
    return {
      items: COUNTRY_CODES.map((code) => {
        const c = COUNTRIES[code];
        return {
          code,
          name: c.name,
          nameFr: c.nameFr,
          mode: c.mode,
          partnerCountry: c.partnerCountry ?? null,
          enabled: c.enabled,
          disabledReason: c.enabled ? null : (c.disabledReason ?? null),
          unverified: c.unverified,
          gdprNotice: c.gdprNotice,
          regions: regions.get(code) ?? 0,
        };
      }),
    };
  });
}
