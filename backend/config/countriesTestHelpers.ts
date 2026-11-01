import type { CountryCode } from '@lead-gen-crm/shared';
import { titleKeywords } from '../runner/keywords.js';
import { COUNTRIES } from './countries.js';

/** The LinkedIn title filter for a country (undefined = no country given). */
export function titleKeywordsFor(country: CountryCode | undefined): string[] {
  return titleKeywords(50, country ? COUNTRIES[country] : undefined);
}
