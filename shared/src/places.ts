import { COUNTRY_REGION_NAMES } from './regionNames.js';

// Small pure helpers for how places are written: names of regions and cities, a Tunisian phone.

/** "ben-arous", "BEN AROUS" or "ben arous" all become "Ben Arous". */
export function titleCase(text: string): string {
  return text
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
    .replace(
      /(^|[\s'(])(\p{L})/gu,
      (_m, lead: string, letter: string) => lead + letter.toLocaleUpperCase(),
    );
}

/** A region id ("sidi-bouzid") as a name ("Sidi Bouzid"); "fr-bretagne" is "Brittany". */
export const regionLabel = (regionId: string): string =>
  COUNTRY_REGION_NAMES[regionId] ?? titleCase(regionId);

const COUNTRY = /^(tunisia|tunisie|tunis[ií]e|تونس)$/i;

/**
 * The city in a Google address such as "Route de Tunis km 3, 3000 Sfax, Tunisia": the last part
 * before the country, without its postal code. Null when the address has no usable part.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '' && !COUNTRY.test(p));
  for (let i = parts.length - 1; i >= 0; i--) {
    const city = parts[i]!.replace(/\b\d{3,5}\b/g, '')
      .replace(/^(gouvernorat|governorate)\s+(de\s+|d['’]\s*)?/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/\p{L}{2,}/u.test(city)) return titleCase(city);
    // Only a postal code in this part: the city is in the one before.
  }
  return null;
}

/** "+33612345678" as "+33 6 12 34 56 78"; "+49…" and "+39…" as the code and the rest. Null if it is neither. */
function formatEuropean(text: string): string | null {
  if (!/^\+\d{8,15}$/.test(text)) return null;
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (fr) return `+33 ${fr[1]} ${fr[2]} ${fr[3]} ${fr[4]} ${fr[5]}`;
  const other = /^\+(49|39)(\d{6,12})$/.exec(text);
  if (other) return `+${other[1]} ${other[2]}`;
  return null;
}

/**
 * A phone number as people write it: "+216 74 679 952" for a Tunisian number in any common
 * form, and anything else as given (a foreign number is shown as typed, trimmed).
 */
export function formatPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return null;
  const european = formatEuropean(trimmed);
  if (european) return european;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00216')) digits = digits.slice(2);
  const national = digits.length === 11 && digits.startsWith('216') ? digits.slice(3) : digits;
  // Eight digits with no other country code are a Tunisian number.
  if (national.length !== 8 || (trimmed.startsWith('+') && national === digits)) return trimmed;
  return `+216 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}
