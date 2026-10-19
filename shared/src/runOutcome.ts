import type { RunFunnel, RunStatus } from './index.js';

// What a run came to, as one plain verdict. The run's status says only whether the process is
// still going or how it ended; this says whether it produced anything. It is computed from the
// run summary alone, so every page that shows a run words it the same way.

export const RUN_OUTCOMES = [
  'running',
  'completed',
  'no_results',
  'nothing_found',
  'ended_early',
  'stopped_by_cap',
  'stopped',
  'failed',
] as const;
export type RunOutcomeKind = (typeof RUN_OUTCOMES)[number];

/** The colour of an outcome's badge: green only for a run that produced leads. */
export type OutcomeTone = 'green' | 'yellow' | 'red' | 'blue' | 'grey';

/** The buckets the Logs filter offers. */
export const OUTCOME_GROUPS = ['running', 'completed', 'ended', 'stopped', 'failed'] as const;
export type OutcomeGroup = (typeof OUTCOME_GROUPS)[number];

export interface RunOutcomeInput {
  status: RunStatus;
  funnel: RunFunnel;
  placesDroppedOutside: number;
}

export interface RunOutcome {
  kind: RunOutcomeKind;
  tone: OutcomeTone;
  group: OutcomeGroup;
  counts: {
    /** Every place the searches returned, inside the region or not. */
    places: number;
    /** Places discarded because they were outside the region's outline. */
    outside: number;
    /** Companies kept for the next steps: qualified, waiting for review, or without a contact. */
    kept: number;
    people: number;
    leads: number;
  };
  /**
   * Which sentence fits when the kind alone is not enough: `outside` (every place was outside
   * the region), `none_kept` (places inside, none kept), `no_people` (companies kept but no
   * people found to carry forward), `no_leads` (people found, none became a lead).
   */
  detail: 'outside' | 'none_kept' | 'no_people' | 'no_leads' | null;
}

/** Every place the searches returned: new ones, ones an earlier run knew, ones outside the region. */
export function placesFound(run: Pick<RunOutcomeInput, 'funnel' | 'placesDroppedOutside'>): number {
  return run.funnel.discovered + run.funnel.skipped + run.placesDroppedOutside;
}

const SHAPE: Record<RunOutcomeKind, { tone: OutcomeTone; group: OutcomeGroup }> = {
  running: { tone: 'blue', group: 'running' },
  completed: { tone: 'green', group: 'completed' },
  no_results: { tone: 'yellow', group: 'ended' },
  nothing_found: { tone: 'yellow', group: 'ended' },
  ended_early: { tone: 'yellow', group: 'ended' },
  stopped_by_cap: { tone: 'red', group: 'stopped' },
  stopped: { tone: 'grey', group: 'stopped' },
  failed: { tone: 'red', group: 'failed' },
};

export function runOutcome(run: RunOutcomeInput): RunOutcome {
  const { funnel } = run;
  const places = placesFound(run);
  const outside = run.placesDroppedOutside;
  const counts = {
    places,
    outside,
    kept: funnel.qualified + funnel.review + funnel.unreachable,
    people: funnel.peopleFound,
    leads: funnel.leads,
  };

  let kind: RunOutcomeKind;
  let detail: RunOutcome['detail'] = null;
  if (run.status === 'pending' || run.status === 'running') kind = 'running';
  else if (run.status === 'failed') kind = 'failed';
  else if (run.status === 'cancelled') kind = 'stopped';
  else if (run.status === 'stopped_by_cap') kind = 'stopped_by_cap';
  else if (counts.leads > 0) kind = 'completed';
  else if (places === 0) kind = 'nothing_found';
  else if (counts.kept === 0) {
    kind = 'no_results';
    detail = outside === places ? 'outside' : 'none_kept';
  } else {
    kind = 'ended_early';
    detail = counts.people === 0 ? 'no_people' : 'no_leads';
  }
  return { kind, ...SHAPE[kind], counts, detail };
}
