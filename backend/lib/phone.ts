// Phone numbers to E.164 for Tunisia (+216 and 8 digits), France, Germany and Italy, and flagging
// the ones from another country. Pure. The rules for France, Germany and Italy are written by
// hand from the public numbering plans (no phone-number library is installed): they check the
// length and the first digits, which is enough to tell a mobile from a landline, not to prove a
// number is in service.

import type { CountryCode } from '@lead-gen-crm/shared';

export type PhoneLine = 'mobile' | 'landline' | 'special';

export interface NormalizedPhone {
  /** "+21698123456" */
  e164: string;
  line: PhoneLine;
}

// First digit of the 8-digit national number. 2, 4, 5 and 9 are mobile operators; 7 is
// fixed line and 3 fixed/VoIP; 8 is toll-free and premium-rate.
const LINE_BY_FIRST_DIGIT: Record<string, PhoneLine> = {
  '2': 'mobile',
  '4': 'mobile',
  '5': 'mobile',
  '9': 'mobile',
  '3': 'landline',
  '7': 'landline',
  '8': 'special',
};

/**
 * "+216 98 123 456", "00216-74.123.456", "(+216) 98123456" or "98 123 456" -> "+21698123456".
 * Returns null for anything that is not one Tunisian number, including foreign numbers;
 * a wrong number is worse than none.
 */
export function normalizePhone(raw: string): NormalizedPhone | null {
  const text = raw.trim().replace(/^(t[ée]l|phone|gsm|mobile)\s*[:.]?\s*/i, '');
  if (text === '') return null;
  // Letters mean an extension or a second sentence ("poste 12", "fax"): don't guess.
  if (/\p{L}/u.test(text)) return null;
  let digits = text.replace(/\(0\)/g, '').replace(/[\s().\-/+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('00216')) digits = digits.slice(5);
  else if (digits.length === 11 && digits.startsWith('216')) digits = digits.slice(3);
  if (digits.length !== 8) return null;
  const line = LINE_BY_FIRST_DIGIT[digits[0]!];
  if (!line) return null;
  return { e164: `+216${digits}`, line };
}

/** Splits "74 123 456 / 98 765 432" style lists and keeps the numbers that normalize. */
export function normalizePhones(raw: string, country: CountryCode = 'TN'): NormalizedPhone[] {
  const seen = new Set<string>();
  const out: NormalizedPhone[] = [];
  for (const part of raw.split(/[,;|]|\s\/\s|\bou\b|\bor\b|\boder\b|\bo\b/i)) {
    const p = normalizeCountryPhone(part, country);
    if (p && !seen.has(p.e164)) {
      seen.add(p.e164);
      out.push(p);
    }
  }
  return out;
}

/** The numbering rules of a country other than Tunisia, on the national number. */
interface CountryPhoneRules {
  calling: string;
  /** Drops the leading 0 people write before the area code (not in Italy, where it is part of the number). */
  trunkZero: boolean;
  /** The line type of a national number (trunk 0 removed where it is dropped), or null when it cannot be one. */
  line: (national: string) => PhoneLine | null;
}

const RULES: Partial<Record<CountryCode, CountryPhoneRules>> = {
  // France: 9 digits after the 0. 01-05 and 09 are landlines (09: internet boxes), 06 and 07
  // mobile, 08 special (toll-free and premium rate).
  FR: {
    calling: '33',
    trunkZero: true,
    line: (n) => {
      if (!/^[1-9]\d{8}$/.test(n)) return null;
      if (n[0] === '6' || n[0] === '7') return 'mobile';
      if (n[0] === '8') return 'special';
      return 'landline';
    },
  },
  // Germany: area codes differ in length, so only the length range (5 to 13 digits after the 0)
  // is checked. Mobile numbers start 015, 016, 017. 0800, 0900, 0180 and 0700 are special.
  DE: {
    calling: '49',
    trunkZero: true,
    line: (n) => {
      if (!/^[1-9]\d{4,12}$/.test(n)) return null;
      if (/^1[567]/.test(n) && n.length >= 10 && n.length <= 11) return 'mobile';
      if (/^(800|900|180|700)/.test(n)) return 'special';
      return 'landline';
    },
  },
  // Italy: the 0 of a landline area code is part of the number. Mobile numbers start 3 and have
  // 9 or 10 digits. 800, 803, 199, 892, 895, 899 are toll-free or premium rate.
  IT: {
    calling: '39',
    trunkZero: false,
    line: (n) => {
      if (/^3\d{8,9}$/.test(n)) return 'mobile';
      if (/^(80[03]|199|89[259])\d{3,7}$/.test(n)) return 'special';
      if (/^0\d{5,10}$/.test(n)) return 'landline';
      return null;
    },
  },
};

/** The national number written in `raw` for a country, and whether it was written with that country's code. */
function splitCountryNumber(
  raw: string,
  rules: CountryPhoneRules,
): { national: string; international: boolean } | null {
  const text = raw.trim().replace(/^(t[ée]l|phone|gsm|mobile|handy|cellulare)\s*[:.]?\s*/i, '');
  if (text === '' || /\p{L}/u.test(text)) return null;
  let digits = text.replace(/\(0\)/g, '').replace(/[\s().\-/+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const plus = /^\(?\s*\+/.test(text);
  let international = false;
  if (digits.startsWith(`00${rules.calling}`)) {
    digits = digits.slice(2 + rules.calling.length);
    international = true;
  } else if (plus && digits.startsWith(rules.calling)) {
    digits = digits.slice(rules.calling.length);
    international = true;
  } else if (plus || digits.startsWith('00')) {
    return null;
  }
  // Written with the country code, a leading 0 is not part of the number ("+33 (0)1 ..."), except in Italy.
  if (rules.trunkZero && digits.startsWith('0')) digits = digits.slice(1);
  return { national: digits, international };
}

/** One number of France, Germany or Italy to E.164, or null when it is not one of that country's numbers. */
export function normalizeCountryPhone(raw: string, country: CountryCode): NormalizedPhone | null {
  if (country === 'TN') return normalizePhone(raw);
  const rules = RULES[country];
  if (!rules) return null;
  const parts = splitCountryNumber(raw, rules);
  if (!parts) return null;
  const line = rules.line(parts.national);
  if (!line) return null;
  return { e164: `+${rules.calling}${parts.national}`, line };
}

export interface ClassifiedPhone {
  /** "+21698123456", or "+33123456789" for a foreign number (digits as given, no checks). */
  e164: string;
  /** Null for a foreign number: its line type is not ours to judge. */
  line: PhoneLine | null;
  /** True when the number carries a country code other than +216. */
  foreign: boolean;
}

/**
 * Like normalizePhone, but a number written with another country code ("+33 1 23 45 67 89",
 * "0033...") is kept and flagged as foreign instead of dropped. Bare local numbers are taken as
 * numbers of `country` (Tunisian unless said otherwise). Returns null for anything that is not a
 * plausible phone number.
 */
export function classifyPhone(raw: string, country: CountryCode = 'TN'): ClassifiedPhone | null {
  const own = normalizeCountryPhone(raw, country);
  if (own) return { ...own, foreign: false };
  const ownCalling = country === 'TN' ? '216' : (RULES[country]?.calling ?? '216');
  const text = raw.trim().replace(/^(t[ée]l|phone|gsm|mobile|handy|cellulare)\s*[:.]?\s*/i, '');
  if (text === '' || /\p{L}/u.test(text)) return null;
  const international = /^\(?\s*(\+|00)/.test(text);
  if (!international) return null;
  const digits = text
    .replace(/\(0\)/g, '')
    .replace(/[\s().\-/+]/g, '')
    .replace(/^00/, '');
  if (!/^\d{8,15}$/.test(digits) || digits.startsWith(ownCalling) || digits.startsWith('0')) {
    return null;
  }
  return { e164: `+${digits}`, line: null, foreign: true };
}
