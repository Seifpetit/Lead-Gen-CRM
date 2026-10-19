// Request and response shapes of the HTTP API (backend/routes). Dates are ISO 8601 strings.
// Every amount is in USD. Anything computed from assumptions is labelled an estimate.
import type {
  BoardStageKey,
  CrmPipeline,
  CrmStage,
  Lead,
  Run,
  RunMode,
  RunStage,
} from './index.js';

export interface ApiError {
  error: string;
  /** Validation problems, by field path. */
  issues?: { path: string; message: string }[];
  message?: string;
}

/** Public: what the sign-in screen may offer. */
export interface AuthConfig {
  /** invite: sign-up needs an invite code; open: anyone may sign up. */
  signupMode: 'invite' | 'open';
  minPasswordLength: number;
  /** Local development only: the sign-in and sign-up forms accept `test` / `test`. */
  devAdminLogin: boolean;
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
  /** Qualified, but with no phone, website or email: kept, never sent to the paid stages. */
  unreachable: number;
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

/** What a run searches, beyond the region. All parts are optional. */
export interface SearchPlanInput {
  /** Sectors to search (default: all). An empty list means only `customWordings`. */
  sectorIds?: string[];
  /** Extra wordings (up to 20, 80 characters each), searched as typed; duplicates are dropped. */
  customWordings?: string[];
  /** Restrict the run to these cells of the region (default: the scheduler's choice). */
  cellKeys?: string[];
}

export interface RunPreviewInput extends SearchPlanInput {
  regionId: string;
  budgetCapUsd?: number;
  mode?: RunMode;
}

export interface StartRunInput extends SearchPlanInput {
  regionId: string;
  budgetCapUsd: number;
  mode?: RunMode;
  /** Must be true: the user has seen the preview and accepts the spend up to the cap. */
  confirm: true;
}

/** One planned search: a wording in a cell. */
export interface PlannedQuery {
  wording: string;
  /** The sector the wording belongs to; null for a wording typed in. */
  sectorId: string | null;
  cellKey: string;
}

/** A sector and the French wordings the grid searches for it. */
export interface SectorInfo {
  id: string;
  name: string;
  wordings: string[];
}

/** What a run would do and cost. Nothing is written or spent to produce it. */
export interface RunPreview {
  regionId: string;
  mode: RunMode;
  /** Cells the run would claim now, and why each was picked. */
  cells: { cellKey: string; reason: string }[];
  /** The first 50 searches the run would make (see queriesTotal for how many in all). */
  queries: PlannedQuery[];
  queriesTotal: number;
  /** Every sector the user can pick, with its wordings. */
  sectors: SectorInfo[];
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

/** Why a result was dropped or a company had no decision-maker, as a code the UI words. */
export type DropReason = 'outside_region' | 'already_known' | 'no_contact' | 'no_email_found';

export type NoDecisionMakerReason =
  'no_people_returned' | 'no_matching_title' | 'not_current' | 'suppressed' | 'removed';

/** What one step's result came to, written when the result was applied. */
export interface StepSummary {
  returned: number;
  kept: number;
  dropped: { reason: DropReason; count: number }[];
  /** People steps only: one company's people and why none (or how many) were decision-makers. */
  people?: {
    found: number;
    decisionMakers: number;
    /** True when the company has no LinkedIn page, so people came from a profile search. */
    noLinkedinPage: boolean;
    reasons: { reason: NoDecisionMakerReason; count: number }[];
  };
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
  /** What the step searched: the wording and map cell, or the company. */
  target: { query: string | null; cell: string | null; company: string | null };
  summary: StepSummary | null;
  costUsd: number;
  durationSeconds: number | null;
  /** The step's error as stored, e.g. "provider status ABORTED". */
  error: string | null;
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

// ---------------------------------------------------------------------------------------
// Coverage by region and sector, and map geometry

export type CoverageState = 'not_searched' | 'yielding' | 'saturated' | 'maintenance';

/** One region x sector. Numbers come from the user's own search history and the cost ledger. */
export interface CoverageEntry {
  regionId: string;
  /** Null: wordings typed in, and spend that cannot be tied to one sector. */
  sectorId: string | null;
  queriesRun: number;
  /** Places not seen before in this user's companies. */
  newPlaces: number;
  leads: number;
  /** From the cost ledger. Settled spend is attributed to the sector of the search or the company. */
  spendUsd: number;
  /** Null when there are no leads. */
  costPerLeadUsd: number | null;
  /** When the sector was last searched in the region; null if never. */
  lastRunAt: string | null;
  /**
   * not_searched: no query yet; yielding: partly covered; saturated: every cell of the region
   * exhausted for the sector; maintenance: saturated, and its last search is older than the
   * maintenance interval, so a slow re-check is due.
   */
  state: CoverageState;
}

export interface Coverage {
  regions: { regionId: string; name: string }[];
  sectors: { id: string; name: string }[];
  entries: CoverageEntry[];
}

/** GeoJSON [lng, lat]; a Polygon or MultiPolygon. */
export interface MapOutline {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}

/** A region's drawn shape: the OpenStreetMap outline, else its bounds as a rectangle. */
export interface RegionGeometry {
  regionId: string;
  name: string;
  bounds: { south: number; west: number; north: number; east: number } | null;
  outline: MapOutline | null;
  outlineSource: 'osm' | 'bounds' | null;
}

// ---------------------------------------------------------------------------------------
// CRM boards

export interface BoardStage {
  key: BoardStageKey;
  name: string;
  /** The column starts collapsed (Noise). */
  collapsedByDefault: boolean;
}

/** One card on a board: a company on the Companies board, a decision-maker on the People board. */
export interface CrmCard {
  id: string;
  pipeline: CrmPipeline;
  stage: BoardStageKey;
  /** When the card entered its current stage; "days in stage" counts from here. */
  stageEnteredAt: string;
  /** Set only in Noise: when the card was removed, when it will be deleted, and where it came from. */
  noiseAt: string | null;
  purgeAt: string | null;
  removedFrom: BoardStageKey | null;
  company: {
    id: string;
    name: string;
    sector: string | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    /** Thumbnail address (never the picture itself) and where it came from. */
    imageUrl: string | null;
    imageSource: 'og' | 'maps' | null;
  };
  /** The decision-maker; null on the Companies board. */
  person: {
    id: string;
    fullName: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    /** Only when the provider returned a photo address. */
    photoUrl: string | null;
  } | null;
  /** Best lead score of the company (Companies board) or of this person's lead (People board). */
  score: number | null;
  /** The company's best lead, which the company page opens; null for a card with no lead. */
  leadId: string | null;
  /** When the company (or the person) was found; "found 2 days ago" counts from here. */
  foundAt: string;
  /** The run that first found it, when that run still exists. */
  runId: string | null;
}

/** Cards per request; each column loads this many, then the next page near its bottom. */
export const BOARD_PAGE_SIZE = 50;

export type BoardSort = 'newest' | 'score' | 'days' | 'name' | 'sector' | 'stage';
export type SortDirection = 'asc' | 'desc';

/** The toolbar's filters and sort; all applied on the server. */
export interface BoardFilters {
  /** Matches company name, website, person name or job title. */
  q?: string | undefined;
  /** A sector id. */
  sector?: string | undefined;
  /** Only cards scoring at least this. */
  minScore?: number | undefined;
  /** Only cards found in the last N days. */
  foundDays?: number | undefined;
  /** Only cards first found by this run. */
  runId?: string | undefined;
  /** Only companies in this region (and their people). */
  regionId?: string | undefined;
  sort?: BoardSort | undefined;
  /** Defaults per sort: newest, score and days run newest/highest/longest first; the rest A to Z. */
  dir?: SortDirection | undefined;
}

/** The cards route: the board's filters plus the column and the cursor of the next page. */
export interface CardsQuery extends BoardFilters {
  stage?: string | undefined;
  /** Leave Noise out: the cards still in play. */
  excludeNoise?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** One column: its true total (with the filters applied) and its first page of cards. */
export interface CrmBoardStage extends BoardStage {
  total: number;
  cards: CrmCard[];
  /** Pass to the cards route for the next page; null when everything is loaded. */
  nextCursor: string | null;
}

export interface CrmBoard {
  pipeline: CrmPipeline;
  stages: CrmBoardStage[];
  /** Sectors on the board (before filtering), for the sector filter. */
  sectors: { id: string; name: string }[];
}

/**
 * How many cards each choice would show, for the folder list of the leads view. Counted with the
 * search, minimum score and found-in filters, and not with the stage, sector or run chosen, so a
 * folder shows what it would hold. Noise is left out.
 */
export interface CrmFacets {
  total: number;
  stages: { key: BoardStageKey; count: number }[];
  sectors: { id: string; name: string; count: number }[];
  /** `id` null: found by a run that has since been deleted. */
  runs: { id: string | null; count: number }[];
}

export interface CrmCardPage {
  cards: CrmCard[];
  /** Cards matching the filters (in the stage, when one was asked for). */
  total: number;
  nextCursor: string | null;
}

export interface DecisionMakerInput {
  fullName: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
}

/** One step in a card's history: the stage it entered (null `from` is the card's creation). */
export interface CardEvent {
  from: BoardStageKey | null;
  to: BoardStageKey;
  at: string;
}

/** Everything the company's own page needs from the CRM, found by company ID. */
export interface CompanyCardDetail {
  /** The company's card on the Companies board (created in Found if it had none). */
  card: CrmCard;
  sectorName: string | null;
  notes: string;
  /** Newest first. */
  history: CardEvent[];
  /** The decision-maker's card on the People board, when one has been added. */
  person: CrmCard | null;
}

export const MAX_NOTES_LENGTH = 5000;

/** The company moved to Decision-maker identified and the new person card (stage New). */
export interface AddDecisionMakerResult {
  company: CrmCard;
  person: CrmCard;
}
