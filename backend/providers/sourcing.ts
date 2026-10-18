import type { EvidenceKind } from '@lead-gen-crm/shared';
import type { Sourced } from '../lib/sourced.js';

/** A trimmed non-empty string, or null. Provider fields are often "", null or missing. */
export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function httpUrl(v: unknown): string | null {
  const t = text(v);
  return t && /^https?:\/\/\S+$/i.test(t) ? t : null;
}

export function sourced(
  value: string | null,
  sourceUrl: string,
  fetchedAt: Date,
  kind: EvidenceKind,
): Sourced<string> | null {
  return value === null ? null : { value, sourceUrl, fetchedAt, kind };
}

/** The provider's own timestamp when it is a valid past date, else the read time. */
export function fetchedAtOf(v: unknown, fallback: Date): Date {
  if (typeof v !== 'string') return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() > fallback.getTime() ? fallback : d;
}

export function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(text).filter((s): s is string => s !== null) : [];
}

export const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
