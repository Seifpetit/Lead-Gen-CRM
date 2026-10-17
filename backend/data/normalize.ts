/** Normalization used for dedupe and suppression keys. Pure functions, no I/O. */

const LEGAL_FORMS = new Set(['sarl', 'suarl', 'sa', 'ste', 'societe', 'sas']);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** "Sté. Transports Ben Salah S.A.R.L." -> "transports ben salah" */
export function normalizeCompanyName(name: string): string {
  const tokens = stripAccents(name)
    .toLowerCase()
    // Collapse dotted abbreviations (s.a.r.l. -> sarl) before splitting on punctuation.
    .replace(/\b((?:[a-z]\.){2,}[a-z]?\.?)/g, (m) => m.replace(/\./g, ''))
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '' && !LEGAL_FORMS.has(t));
  return tokens.join(' ');
}

// Hosts where the path, not the host, identifies the business: never a company domain.
const SHARED_HOSTS = [
  'facebook.com',
  'fb.com',
  'm.facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'wa.me',
  'linktr.ee',
  'google.com',
  'goo.gl',
  'business.site',
  'gmail.com',
  'yahoo.com',
  'yahoo.fr',
  'hotmail.com',
  'outlook.com',
];

/** "https://www.Example.tn/contact" -> "example.tn". Returns null for social and shared hosts. */
export function normalizeDomain(urlOrHost: string): string | null {
  const trimmed = urlOrHost.trim();
  if (trimmed === '') return null;
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host.includes('.')) return null;
  if (SHARED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return host;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, with Tunisia's country code added to bare 8-digit numbers. */
export function phoneKey(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = `216${digits}`;
  return digits;
}

export function normalizeLinkedinId(id: string): string {
  return decodeURIComponent(id).trim().toLowerCase();
}

/** "  Usine  Agroalimentaire " -> "usine agroalimentaire": groups the same wording across runs. */
export function normalizeQuery(query: string): string {
  return stripAccents(query).toLowerCase().replace(/\s+/g, ' ').trim();
}
