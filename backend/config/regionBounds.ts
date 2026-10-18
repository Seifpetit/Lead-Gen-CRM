import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate, from OpenStreetMap (Nominatim `boundingbox` of the
 * governorate relation). Written by `npm run regions:fetch`; do not edit by hand (use
 * `npm run regions:set-bounds` for a manual fix, which the seed then leaves alone).
 *
 * Source: OpenStreetMap contributors, ODbL, via nominatim.openstreetmap.org.
 * Fetched: 2026-10-18.
 *
 * manouba: derived from the neighbouring governorate outlines (the hole they leave around lat 36.81, lon 10.00), not an OpenStreetMap polygon (box of the derived outline, 1139 km2, 2026-10-18).
 */
export const REGION_BOUNDS: Partial<Record<GovernorateId, Bounds>> = {
  tunis: { south: 36.6925111, west: 10.0037899, north: 36.9430196, east: 10.3548094 },
  ariana: { south: 36.8219597, west: 9.9632889, north: 37.1151625, east: 10.2887394 },
  'ben-arous': { south: 36.4464359, west: 10.0429521, north: 36.812548, east: 10.41874 },
  nabeul: { south: 36.3528271, west: 10.3323047, north: 37.1431465, east: 11.1366812 },
  zaghouan: { south: 36.00057, west: 9.594528, north: 36.662768, east: 10.3908859 },
  bizerte: { south: 36.7234013, west: 8.8687807, north: 37.560954, east: 10.330927 },
  beja: { south: 36.3354486, west: 8.8847865, north: 37.157108, east: 9.864133 },
  jendouba: { south: 36.3472229, west: 8.1536515, north: 37.008457, east: 9.0767736 },
  kef: { south: 35.9430815, west: 8.766873, north: 36.1830139, east: 9.1707558 },
  siliana: { south: 35.4772545, west: 8.9243612, north: 36.465258, east: 9.7695935 },
  sousse: { south: 35.396077, west: 10.157704, north: 36.3917716, east: 10.6873756 },
  monastir: { south: 35.4227413, west: 10.4930635, north: 35.8053279, east: 11.0499022 },
  mahdia: { south: 35.0862834, west: 10.1605583, north: 35.5954334, east: 11.1675977 },
  sfax: { south: 34.1680323, west: 9.7110985, north: 35.2785064, east: 11.363275 },
  kairouan: { south: 35.0202298, west: 9.2694302, north: 36.1383343, east: 10.307273 },
  kasserine: { south: 34.62741, west: 8.245209, north: 35.7909169, east: 9.3393882 },
  'sidi-bouzid': { south: 34.2647359, west: 8.9208807, north: 35.4956739, east: 10.0636092 },
  gabes: { south: 33.2698819, west: 9.2473919, north: 34.2826249, east: 10.4802462 },
  medenine: { south: 32.2499202, west: 9.7096404, north: 33.915728, east: 11.5999351 },
  tataouine: { south: 30.229061, west: 8.35683, north: 33.234752, east: 11.3419785 },
  gafsa: { south: 34.05264, west: 8.041679, north: 34.8102274, east: 9.56073 },
  tozeur: { south: 33.424659, west: 7.5219807, north: 34.5323541, east: 8.64814 },
  kebili: { south: 32.502602, west: 7.732558, north: 34.1854278, east: 10.0116637 },
  manouba: { south: 36.558, west: 9.568, north: 36.968, east: 10.118 },
};
