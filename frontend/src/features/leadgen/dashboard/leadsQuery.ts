import type {
  BoardSort,
  CardsQuery,
  CrmPipeline,
  SortDirection,
  TradeFilter,
} from '@lead-gen-crm/shared';

/** The Import/export filter as one choice; "default" is Yes plus Not checked. */
export const TRADE_CHOICES = ['default', 'yes', 'unchecked', 'no', 'all'] as const;
export type TradeChoice = (typeof TRADE_CHOICES)[number];
const TRADE_OF: Record<Exclude<TradeChoice, 'default'>, readonly TradeFilter[]> = {
  yes: ['yes'],
  unchecked: ['unchecked'],
  no: ['no'],
  all: ['yes', 'unchecked', 'no'],
};
/** The list the server wants; nothing for the default, which is the server's own default. */
export const tradeOf = (c: TradeChoice): readonly TradeFilter[] | undefined =>
  c === 'default' ? undefined : TRADE_OF[c];

/** How far back "Found" reaches: the last 7 or 30 days, or everything. */
export const FOUND_WINDOWS = ['7', '30', 'all'] as const;
export type FoundWindow = (typeof FOUND_WINDOWS)[number];

export const LEAD_SORTS = [
  'newest',
  'score',
  'name',
  'sector',
  'days',
] as const satisfies readonly BoardSort[];
/** The minimum-score slider: 0 is "any". */
export const SCORE_MAX = 100;
export const SCORE_STEP = 5;

/** How much a card shows: comfortable has every badge, compact is smaller and keeps two. */
export type Density = 'comfortable' | 'compact';

/** What the Recent leads view shows; the panel and its expanded window share one of these. */
export interface LeadsQuery {
  pipeline: CrmPipeline;
  found: FoundWindow;
  q: string;
  minScore: number;
  sort: BoardSort;
  dir: SortDirection | undefined;
  /** The stage chip or folder; null is "All". */
  stage: string | null;
  sector: string | null;
  runId: string | null;
  trade: TradeChoice;
}

export const initialQuery: LeadsQuery = {
  pipeline: 'companies',
  found: 'all',
  q: '',
  minScore: 0,
  sort: 'newest',
  dir: undefined,
  stage: null,
  sector: null,
  runId: null,
  trade: 'default',
};

/** The filters the folder counts follow: everything except the folder itself. */
export function facetFilters(query: LeadsQuery, regionId: string) {
  return {
    q: query.q.trim() || undefined,
    minScore: query.minScore || undefined,
    foundDays: query.found === 'all' ? undefined : Number(query.found),
    regionId: regionId || undefined,
    trade: tradeOf(query.trade),
  };
}

/** The server's card filters for this view; Noise is always left out. */
export function cardFilters(query: LeadsQuery, regionId: string): CardsQuery {
  return {
    ...facetFilters(query, regionId),
    stage: query.stage ?? undefined,
    sector: query.sector ?? undefined,
    runId: query.runId ?? undefined,
    sort: query.sort,
    dir: query.dir,
    excludeNoise: true,
  };
}

/** A stable key for "the same view", so a change of view starts from the first page. */
export const queryKey = (f: CardsQuery) => JSON.stringify(f);

/** True when anything but the search box narrows the view, or the search has text. */
export const hasFilters = (q: LeadsQuery) =>
  q.q.trim() !== '' ||
  q.minScore > 0 ||
  q.found !== 'all' ||
  q.stage !== null ||
  q.sector !== null ||
  q.runId !== null ||
  q.trade !== 'default';
