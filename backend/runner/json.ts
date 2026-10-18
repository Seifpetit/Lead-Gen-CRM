import type { Sourced } from '../lib/sourced.js';

// Stage outputs are stored as JSON (run_steps.output, run_companies.payload). Sourced values
// lose their Date on the way in; this puts it back on the way out.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Deep copy with every `fetchedAt` ISO string turned back into a Date. */
export function reviveDates<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value ?? null), (key, v) =>
    key === 'fetchedAt' && typeof v === 'string' && ISO.test(v) ? new Date(v) : v,
  ) as T;
}

export function isSourced(v: unknown): v is Sourced<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'value' in v &&
    'sourceUrl' in v &&
    'fetchedAt' in v &&
    (v as { fetchedAt: unknown }).fetchedAt instanceof Date
  );
}
