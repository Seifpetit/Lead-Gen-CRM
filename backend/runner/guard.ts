import type { StepSummary } from '@lead-gen-crm/shared';

// A run whose first searches come back almost entirely from outside the region is searching the
// wrong place. It is stopped before it spends more, and the person is told in plain words.

/** How many of a run's first finished searches are looked at. */
export const GUARD_WINDOW = 8;
/** The fewest finished searches needed before the guard may stop a run. */
export const GUARD_MIN_SEARCHES = 5;
/** And the fewest places those searches returned, so a few empty searches prove nothing. */
export const GUARD_MIN_PLACES = 20;
/** Stop when more than this share of the places lay outside the region. */
export const GUARD_OUTSIDE_SHARE = 0.9;

export interface OutsideVerdict {
  stop: boolean;
  searches: number;
  returned: number;
  outside: number;
}

/**
 * `summaries` are the summaries of a run's finished searches, oldest first. Pure.
 */
export function outsideRegionVerdict(summaries: readonly StepSummary[]): OutsideVerdict {
  const first = summaries.slice(0, GUARD_WINDOW);
  let returned = 0;
  let outside = 0;
  for (const s of first) {
    returned += s.returned;
    outside += s.dropped.find((d) => d.reason === 'outside_region')?.count ?? 0;
  }
  return {
    stop:
      first.length >= GUARD_MIN_SEARCHES &&
      returned >= GUARD_MIN_PLACES &&
      outside / returned > GUARD_OUTSIDE_SHARE,
    searches: first.length,
    returned,
    outside,
  };
}
