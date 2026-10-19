import type { BoardSort, CardsQuery, CrmPipeline, SortDirection } from '@lead-gen-crm/shared';

/** How far back "Found" reaches: the last 7 or 30 days, or everything. */
export const FOUND_WINDOWS = ['7', '30', 'all'] as const;
export type FoundWindow = (typeof FOUND_WINDOWS)[number];

export const LEAD_SORTS = ['newest', 'score', 'name'] as const satisfies readonly BoardSort[];
export const MIN_SCORES = ['0', '50', '70'] as const;

/** What the Recent leads view shows; the panel and its expanded window share one of these. */
export interface LeadsQuery {
  pipeline: CrmPipeline;
  found: FoundWindow;
  q: string;
  minScore: (typeof MIN_SCORES)[number];
  sort: BoardSort;
  dir: SortDirection | undefined;
  /** The stage chip or folder; null is "All". */
  stage: string | null;
  sector: string | null;
  runId: string | null;
}

export const initialQuery: LeadsQuery = {
  pipeline: 'companies',
  found: 'all',
  q: '',
  minScore: '0',
  sort: 'newest',
  dir: undefined,
  stage: null,
  sector: null,
  runId: null,
};

/** The filters the folder counts follow: everything except the folder itself. */
export function facetFilters(query: LeadsQuery, regionId: string) {
  return {
    q: query.q.trim() || undefined,
    minScore: Number(query.minScore) || undefined,
    foundDays: query.found === 'all' ? undefined : Number(query.found),
    regionId: regionId || undefined,
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
