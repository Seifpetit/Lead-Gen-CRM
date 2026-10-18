// Request and response shapes of the HTTP API (backend/routes). Dates are ISO 8601 strings.
// Every amount is in USD. Anything computed from assumptions is labelled an estimate.
import type { CrmStage, Lead, Run, RunMode, RunStage } from './index.js';

export interface ApiError {
  error: string;
  /** Validation problems, by field path. */
  issues?: { path: string; message: string }[];
  message?: string;
}

/** Every list endpoint takes ?limit (1 to 100, default 50) and ?offset. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  /** Offset of the next page, or null on the last page. */
  nextOffset: number | null;
}

// ---------------------------------------------------------------------------------------
// Runs

/** Companies per funnel state in one run, and the leads it produced. */
export interface RunFunnel {
  discovered: number;
  /** Found again: already known to this user, not sent through the paid stages. */
  skipped: number;
  qualified: number;
  rejected: number;
  review: number;
  peopleFound: number;
  enriched: number;
  scored: number;
  leads: number;
}

export interface RunSummary extends Run {
  funnel: RunFunnel;
  error: string | null;
}

export interface RunStepCounts {
  stage: RunStage;
  pending: number;
  inFlight: number;
  finished: number;
  failed: number;
}

export interface RunDetail extends RunSummary {
  steps: RunStepCounts[];
  /** First page of the run's leads, best score first; see GET /api/leads?runId= for more. */
  leads: Lead[];
  leadsTotal: number;
}

export type StartBlockerCode =
  | 'monthly_cap_reached'
  | 'cap_exceeds_month_remaining'
  | 'concurrent_run_limit'
  | 'no_bounds'
  | 'no_free_cells'
  | 'budget_below_minimum';

export interface StartBlocker {
  code: StartBlockerCode;
  message: string;
}

export interface RunPreviewInput {
  regionId: string;
  sectors?: string[];
  budgetCapUsd?: number;
  mode?: RunMode;
}

export interface StartRunInput {
  regionId: string;
  sectors?: string[];
  budgetCapUsd: number;
  mode?: RunMode;
  /** Must be true: the user has seen the preview and accepts the spend up to the cap. */
  confirm: true;
}

/** What a run would do and cost. Nothing is written or spent to produce it. */
export interface RunPreview {
  regionId: string;
  mode: RunMode;
  /** Cells the run would claim now, and why each was picked. */
  cells: { cellKey: string; reason: string }[];
  queries: number;
  /** Volumes are estimates from this user's history where it exists, else the plan's funnel. */
  volume: {
    placesMax: number;
    places: number;
    newPlaces: number;
    qualified: number;
    people: number;
    leads: number;
    kind: 'estimate';
  };
  cost: {
    discoverUsd: number;
    findPeopleUsd: number;
    enrichUsd: number;
    totalUsd: number;
    /** Estimated cost per lead, null when no leads are expected. */
    perLeadUsd: number | null;
    /** The most the first pass could reserve: every query returning its maximum places. */
    upperBoundUsd: number;
    kind: 'estimate';
  };
  limits: {
    budgetCapUsd: number | null;
    monthCapUsd: number | null;
    monthSpentUsd: number;
    monthRemainingUsd: number | null;
    activeRuns: number;
    maxActiveRuns: number;
  };
  /** Reasons a start would be refused right now (empty when it can start). */
  blockers: StartBlocker[];
  /** Plain-language assumptions behind the numbers. */
  assumptions: string[];
}

// ---------------------------------------------------------------------------------------
// Regions and coverage

export interface RegionSummary {
  regionId: string;
  name: string;
  hasBounds: boolean;
  status: 'active' | 'saturated';
  saturatedAt: string | null;
  cellsTotal: number;
  cellsSearched: number;
  cellsExhausted: number;
  /** cellsSearched / cellsTotal; null before the region has cells. */
  coverage: number | null;
  queriesRun: number;
  placesFound: number;
  /** New places per query: the yield the exhaustion rule watches. */
  newPlacesPerQuery: number | null;
  qualifiedShare: number | null;
  decisionMakerShare: number | null;
  channelShare: number | null;
  spendUsd: number;
  leads: number;
  costPerLeadUsd: number | null;
  runs: number;
  lastRunAt: string | null;
}

export interface CellSummary {
  regionCellId: string;
  cellKey: string;
  bounds: { south: number; west: number; north: number; east: number };
  spendUsd: number;
  leads: number;
  queriesRun: number;
  placesFound: number;
  newPlacesFound: number;
  lastRunAt: string | null;
  exhaustedAt: string | null;
  claimedByRunId: string | null;
}

export interface CellDetail extends CellSummary {
  exhaustedWordings: string[];
  /** Searches run in the cell, newest first. */
  queries: {
    queryText: string;
    provider: string;
    resultsReturned: number;
    newPlacesFound: number;
    costUsd: number;
    at: string;
  }[];
}

export interface RegionSuggestionView {
  regionId: string | null;
  mode: RunMode;
  reason: string;
  widening: string[];
  ranking: {
    regionId: string;
    status: 'active' | 'saturated';
    leadsPerDollar: number | null;
    coverage: number;
    maintenanceDue: boolean;
  }[];
}

// ---------------------------------------------------------------------------------------
// Leads and CRM

export interface LeadFilter {
  stage?: CrmStage[];
  runId?: string;
  regionId?: string;
  minScore?: number;
  /** Matches company or contact name. */
  q?: string;
}

export interface MoveLeadInput {
  stage: CrmStage;
  /** Required when the stage is opted_out: the person's objection, kept with the suppression. */
  reason?: string;
}

export interface ObjectionInput {
  reason: string;
}

export interface ObjectionResult {
  lead: Lead;
  /** Identifiers added to the suppression list (email, phone, linkedin). */
  suppressed: string[];
}

// ---------------------------------------------------------------------------------------
// Costs

export type CostGroupBy = 'run' | 'region' | 'provider' | 'month';

export interface CostRow {
  key: string;
  /** Estimates not yet replaced by an actual. */
  openEstimateUsd: number;
  actualUsd: number;
  /** What the ledger counts as spent: open estimates plus actuals. */
  totalUsd: number;
  entries: number;
}

export interface BudgetView {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  capUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
}

export interface LedgerEntryView {
  id: string;
  runStepId: string | null;
  provider: string;
  item: string;
  units: number;
  unitPriceUsd: number;
  amountUsd: number;
  kind: 'estimated' | 'actual';
  correctsId: string | null;
  createdAt: string;
}

export interface RunCostsView {
  runId: string;
  entries: Page<LedgerEntryView>;
  estimatedUsd: number;
  actualUsd: number;
  ledgerUsd: number;
  unsettledEstimateUsd: number;
  flagged: { runStepId: string; stepKey: string; differenceUsd: number; note: string }[];
}

// ---------------------------------------------------------------------------------------
// Apify log

export type ApifyState = 'started' | 'running' | 'restarting' | 'resumed' | 'finished' | 'failed';

export interface ApifyEventView {
  id: string;
  runId: string;
  runStepId: string;
  apifyRunId: string;
  state: ApifyState;
  message: string | null;
  occurredAt: string;
}

export interface ApifyStepView {
  runStepId: string;
  stage: RunStage;
  stepKey: string;
  actorId: string | null;
  apifyRunId: string | null;
  apifyStatus: string | null;
  latestState: ApifyState | null;
  history: ApifyEventView[];
}

export interface ApifyLogRun {
  run: RunSummary;
  /** Every Apify run of the run's steps, with its state history. */
  steps: ApifyStepView[];
}

export interface ApifyLog {
  /** Active runs first, then the most recent ones, each with its Apify state history. */
  runs: ApifyLogRun[];
  /** Apify runs whose latest state is restarting or resumed and that haven't finished. */
  attention: ApifyStepView[];
  /** Latest state changes across all runs, newest first. */
  recent: Page<ApifyEventView>;
}
