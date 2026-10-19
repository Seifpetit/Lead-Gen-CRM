import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate: the smallest rectangle around its outline in
 * regionOutlines.json. Written by `npm run regions:build`; do not edit by hand (use
 * `npm run regions:set-bounds` for a manual fix, which the seed then leaves alone).
 *
 * Boundaries: geoBoundaries (Runfola et al. 2020, www.geoboundaries.org), derived from OpenStreetMap contributors.
 * Licence: Open Data Commons Open Database License 1.0 (https://www.openstreetmap.org/copyright). Built: 2026-10-19.
 */
export const REGION_BOUNDS: Record<GovernorateId, Bounds> = {
  tunis: { south: 36.692511, west: 10.00379, north: 36.943157, east: 10.354809 },
  'ben-arous': { south: 36.446436, west: 10.042952, north: 36.812548, east: 10.41874 },
  kef: { south: 35.615945, west: 8.253461, north: 36.453426, east: 9.170756 },
  sousse: { south: 35.396077, west: 10.1585, north: 36.391772, east: 10.686715 },
  sfax: { south: 34.167997, west: 9.711099, north: 35.278506, east: 11.343104 },
  jendouba: { south: 36.347223, west: 8.153652, north: 37.00862, east: 9.076774 },
  kairouan: { south: 35.02023, west: 9.26943, north: 36.138334, east: 10.307273 },
  kasserine: { south: 34.62741, west: 8.245209, north: 35.790917, east: 9.339388 },
  mahdia: { south: 35.088914, west: 10.160558, north: 35.595433, east: 11.166431 },
  manouba: { south: 36.552974, west: 9.56626, north: 36.971661, east: 10.119171 },
  'sidi-bouzid': { south: 34.264736, west: 8.920881, north: 35.495674, east: 10.063609 },
  kebili: { south: 32.502602, west: 7.732558, north: 34.185428, east: 10.011664 },
  beja: { south: 36.335449, west: 8.88456, north: 37.157023, east: 9.864133 },
  tataouine: { south: 30.230236, west: 8.35683, north: 33.234752, east: 11.341979 },
  gabes: { south: 33.269882, west: 9.247392, north: 34.282625, east: 10.480513 },
  bizerte: { south: 36.723401, west: 8.898594, north: 37.54226, east: 10.281482 },
  ariana: { south: 36.821974, west: 9.963289, north: 37.115163, east: 10.28864 },
  nabeul: { south: 36.352754, west: 10.332305, north: 37.143147, east: 11.136732 },
  monastir: { south: 35.422741, west: 10.493064, north: 35.805551, east: 11.04986 },
  siliana: { south: 35.477255, west: 8.924361, north: 36.465258, east: 9.769694 },
  zaghouan: { south: 36.00057, west: 9.594528, north: 36.662768, east: 10.390886 },
  gafsa: { south: 34.05264, west: 8.041679, north: 34.810227, east: 9.56073 },
  medenine: { south: 32.24992, west: 9.70964, north: 33.915116, east: 11.599935 },
  tozeur: { south: 33.424659, west: 7.521981, north: 34.532354, east: 8.64814 },
};
