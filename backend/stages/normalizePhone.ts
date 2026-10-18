// Tunisian phone numbers to E.164 (+216 and 8 digits). Pure.

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
export function normalizePhones(raw: string): NormalizedPhone[] {
  const seen = new Set<string>();
  const out: NormalizedPhone[] = [];
  for (const part of raw.split(/[,;|]|\s\/\s|\bou\b|\bor\b/i)) {
    const p = normalizePhone(part);
    if (p && !seen.has(p.e164)) {
      seen.add(p.e164);
      out.push(p);
    }
  }
  return out;
}
