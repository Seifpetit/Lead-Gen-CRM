import type { CountryCode, TradeRole } from './index.js';

// The developer console: run one pipeline step by hand and see what went in and what came out.
// Debugging only; the server answers 404 to all of it unless DEV_CONSOLE is on and the admin asks.

export const DEV_STEPS = ['discover', 'classify'] as const;
export type DevStep = (typeof DEV_STEPS)[number];

/** The limits the server enforces (the form shows the same numbers). */
export const DEV_LIMITS = {
  maxWords: 5,
  maxWordChars: 80,
  maxPlacesPerSearch: 20,
  defaultPlacesPerSearch: 5,
  maxCompanies: 20,
  /**
   * Google Maps cannot be capped below this: Apify refuses a lower maximum cost, so a search only
   * starts while at least this much of the cap is still free. A $1.00 cap therefore fits several
   * words (they cost cents each); a $0.50 cap fits one.
   */
  discoverCapMinUsd: 0.5,
  discoverCapDefaultUsd: 1,
  discoverCapMaxUsd: 1,
  classifyCapDefaultUsd: 0.1,
  classifyCapMaxUsd: 0.5,
} as const;

export type DevArea =
  | { kind: 'cell'; regionId: string; cellKey: string }
  | { kind: 'region'; regionId: string }
  | { kind: 'rect'; south: number; west: number; north: number; east: number };

export interface DevDiscoverInput {
  country: CountryCode;
  language: 'fr' | 'en';
  words: string[];
  area: DevArea;
  maxPlaces: number;
  capUsd: number;
}

export interface DevCompanyInput {
  name: string;
  category?: string;
  website?: string;
  /** Anything else known about the company, sent to the classifier as one more detail. */
  text?: string;
}

export interface DevClassifyInput {
  country: CountryCode;
  companies: DevCompanyInput[];
  capUsd: number;
}

export type DevStepInput = DevDiscoverInput | DevClassifyInput;

export interface DevPlaceRow {
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  /** The search word that found it. */
  word: string;
  /** Null when the area has no region outline to compare with (a custom rectangle). */
  outsideRegion: boolean | null;
  alreadyKnown: boolean;
  noContact: boolean;
}

export interface DevSearchResult {
  word: string;
  returned: number;
  costUsd: number;
  apifyRunId: string | null;
  apifyRunUrl: string | null;
  status: string;
}

export interface DevDiscoverOutput {
  /** What was sent to Apify, one request per word, with secrets masked. */
  requests: unknown[];
  searches: DevSearchResult[];
  places: DevPlaceRow[];
  counts: {
    returned: number;
    new: number;
    outsideRegion: number;
    alreadyKnown: number;
    noContact: number;
  };
  durationMs: number;
  /** Words that were not searched because the spend cap was reached. */
  skippedWords: string[];
  notice: string | null;
}

export interface DevClassifyRow {
  name: string;
  tradeRole: TradeRole | null;
  evidence: string;
  model: string | null;
  costUsd: number;
  failed: boolean;
}

export interface DevClassifyOutput {
  rows: DevClassifyRow[];
  /** The question the classifier was given for this country. */
  system: string;
  skipped: number;
  durationMs: number;
  notice: string | null;
}

export type DevStepOutput = DevDiscoverOutput | DevClassifyOutput;

export type DevStepStatus = 'running' | 'succeeded' | 'failed';

export interface DevHistoryEntry {
  id: string;
  step: DevStep;
  status: DevStepStatus;
  /** One line for the list. */
  summary: string;
  input: DevStepInput;
  output: DevStepOutput | null;
  costUsd: number;
  error: string | null;
  createdAt: string;
  /** Who ran it. */
  by: string;
}

export interface DevEstimate {
  step: DevStep;
  estimateUsd: number;
  /** What the step may spend at most (the call's cap, and what the month still allows). */
  capUsd: number;
  lines: { label: string; usd: number }[];
  /** Discover: the exact requests. Classify: the question. Secrets are masked. */
  requests: unknown[];
  searches: number;
  notice: string | null;
}

export interface DevAreaOption {
  regionId: string;
  name: string;
  country: CountryCode;
  bounds: { south: number; west: number; north: number; east: number } | null;
  cells: { cellKey: string; south: number; west: number; north: number; east: number }[];
}

export interface DevOptions {
  countries: { code: CountryCode; name: string; languages: ('fr' | 'en')[] }[];
  areas: DevAreaOption[];
  classifierConfigured: boolean;
  classifierModel: string;
  limits: typeof DEV_LIMITS;
}
