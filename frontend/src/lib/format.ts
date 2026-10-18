import type { Evidence } from '@lead-gen-crm/shared';

/** USD with cents for small amounts (estimates are often under a dollar). */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 1 && value !== 0 ? 3 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatNumber(value * 100, 0)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
    .format(d)
    .concat(' UTC');
}

/** "2026-10" or a full date's month, for the costs table. */
export function formatMonth(key: string): string {
  const d = new Date(/^\d{4}-\d{2}$/.test(key) ? `${key}-01T00:00:00Z` : key);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Only http(s) links are ever rendered as links: a stored value is data, not a script. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The newest evidence for a field, preferring one that recorded the value being shown. A value
 * with no evidence is flagged by the caller, never given a made-up source.
 */
export function evidenceFor(
  evidence: readonly Evidence[],
  field: string | readonly string[],
  value?: string | null,
): Evidence | null {
  const fields = typeof field === 'string' ? [field] : field;
  for (const f of fields) {
    const all = evidence
      .filter((e) => e.field === f)
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    const exact = value ? all.find((e) => e.value === value) : undefined;
    const found = exact ?? all[0];
    if (found) return found;
  }
  return null;
}

/** "45s", "1m 05s" or "1h 02m" for a number of seconds. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
