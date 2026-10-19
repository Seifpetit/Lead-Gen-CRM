import type { BoardFilters, BoardSort, SortDirection } from '@lead-gen-crm/shared';
import type { BoardView } from './useBoard.js';

/** The order each sort runs in until it is flipped; the same defaults as the server's. */
export const DEFAULT_DIRECTION: Record<BoardSort, SortDirection> = {
  newest: 'desc',
  score: 'desc',
  days: 'asc',
  name: 'asc',
  sector: 'asc',
  stage: 'asc',
};

export const DEFAULT_SORT: BoardSort = 'score';

export interface BoardQuery extends BoardFilters {
  view: BoardView;
}

/** The board's filters, sort and view live in the address, so a reload or a shared link keeps them. */
export function readQuery(params: URLSearchParams): BoardQuery {
  const sort = params.get('sort');
  const dir = params.get('dir');
  const min = Number(params.get('min'));
  const q = params.get('q')?.trim();
  const sector = params.get('sector');
  return {
    view: params.get('view') === 'table' ? 'table' : 'board',
    q: q || undefined,
    sector: sector || undefined,
    minScore: Number.isFinite(min) && min > 0 ? min : undefined,
    sort: (['newest', 'score', 'days', 'name', 'sector'] as const).find((s) => s === sort),
    dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
  };
}

export function writeQuery(query: BoardQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view === 'table') params.set('view', 'table');
  if (query.q) params.set('q', query.q);
  if (query.sector) params.set('sector', query.sector);
  if (query.minScore) params.set('min', String(query.minScore));
  if (query.sort) params.set('sort', query.sort);
  if (query.dir) params.set('dir', query.dir);
  return params;
}

export const effectiveSort = (q: BoardFilters): BoardSort => q.sort ?? DEFAULT_SORT;
export const effectiveDirection = (q: BoardFilters): SortDirection =>
  q.dir ?? DEFAULT_DIRECTION[effectiveSort(q)];
