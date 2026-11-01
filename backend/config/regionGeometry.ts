import type { Bounds, Outline } from '../lib/geo.js';
import outlinesFile from './regionOutlines.json' with { type: 'json' };
import frFile from './regionOutlines.fr.json' with { type: 'json' };
import deFile from './regionOutlines.de.json' with { type: 'json' };
import itFile from './regionOutlines.it.json' with { type: 'json' };
import { REGION_BOUNDS } from './regionBounds.js';
import type { RegionGeometry } from '../data/regions.js';
import type { CountryCode } from './countries.js';

/** Committed bounds and simplified outlines per governorate id, ready for `upsertRegions`. */
export function committedRegionGeometry(): Record<string, RegionGeometry> {
  // The JSON is typed by shape (arrays of number arrays); the fetch script writes valid outlines.
  const outlines = outlinesFile.outlines as unknown as Record<string, Outline>;
  const out: Record<string, RegionGeometry> = {};
  for (const id of new Set([...Object.keys(REGION_BOUNDS), ...Object.keys(outlines)])) {
    const bounds: Bounds | undefined = (REGION_BOUNDS as Record<string, Bounds>)[id];
    const outline = outlines[id];
    out[id] = { ...(bounds ? { bounds } : {}), ...(outline ? { outline } : {}) };
  }
  return out;
}

/** Where a country's outline file came from, for the map credit and the README. */
export interface CountryOutlineCredit {
  attribution: string;
  license: string;
  licenseUrl: string;
}

interface CountryFile {
  attribution: string;
  license: string;
  licenseUrl: string;
  bounds: Record<string, Bounds>;
  outlines: Record<string, unknown>;
}

const COUNTRY_FILES: Record<Exclude<CountryCode, 'TN'>, CountryFile> = {
  FR: frFile as unknown as CountryFile,
  DE: deFile as unknown as CountryFile,
  IT: itFile as unknown as CountryFile,
};

/** Committed bounds and outlines for France, Germany or Italy, by namespaced region id. */
export function committedCountryGeometry(
  country: Exclude<CountryCode, 'TN'>,
): Record<string, RegionGeometry> {
  const file = COUNTRY_FILES[country];
  const out: Record<string, RegionGeometry> = {};
  for (const id of Object.keys(file.outlines)) {
    out[id] = { bounds: file.bounds[id]!, outline: file.outlines[id] as Outline };
  }
  return out;
}

export function countryOutlineCredit(country: Exclude<CountryCode, 'TN'>): CountryOutlineCredit {
  const { attribution, license, licenseUrl } = COUNTRY_FILES[country];
  return { attribution, license, licenseUrl };
}
