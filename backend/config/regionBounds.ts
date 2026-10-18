import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate, from OpenStreetMap (Nominatim `boundingbox` of the
 * governorate relation). Written by `npm run regions:fetch`; do not edit by hand (use
 * `npm run regions:set-bounds` for a manual fix, which the seed then leaves alone).
 *
 * Source: OpenStreetMap contributors, ODbL, via nominatim.openstreetmap.org.
 * Fetched: not fetched yet. Run `npm run regions:fetch` from a machine that can reach Nominatim.
 * Regions listed here are applied by `npm run db:migrate` / `db:seed`.
 */
export const REGION_BOUNDS: Partial<Record<GovernorateId, Bounds>> = {};
