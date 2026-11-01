import { countryRoleKeywords, type CountryConfig } from '../config/countries.js';
import { TITLE_DICTIONARY } from '../config/titles.js';

/**
 * Title words for the LinkedIn filters, at most 50. A country that is not Tunisia puts its own
 * role words first (written in its language), then the round-robin across role classes.
 */
export function titleKeywords(limit = 50, country?: CountryConfig): string[] {
  const lists = Object.values(TITLE_DICTIONARY).map((l) => l.filter((v) => v.length > 3));
  const out: string[] = [];
  if (country && country.code !== 'TN') {
    for (const w of countryRoleKeywords(country)) {
      if (out.length < limit) out.push(w);
    }
  }
  const seen = new Set(out.map((w) => w.toLowerCase()));
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (i < l.length && out.length < limit && !seen.has(l[i]!)) out.push(l[i]!);
    }
  }
  return out;
}
