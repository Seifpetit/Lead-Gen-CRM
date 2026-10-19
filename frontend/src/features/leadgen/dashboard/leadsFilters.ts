import type { BoardStageKey, CrmFacets, RunSummary } from '@lead-gen-crm/shared';
import { useMemo } from 'react';
import type { FilterField } from '../../../components/shared/FilterMenu.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { formatDay } from '../../../lib/format.js';
import type { LeadsView } from './LeadsControls.js';
import {
  FOUND_WINDOWS,
  LEAD_SORTS,
  SCORE_MAX,
  SCORE_STEP,
  type Density,
  type LeadsQuery,
} from './leadsQuery.js';

/** A run named by its region and day; runs from before the list kept are "Earlier run". */
export function runLabel(runs: readonly RunSummary[], id: string | null, earlier: string): string {
  const run = runs.find((r) => r.id === id);
  return run ? `${run.region} · ${formatDay(run.createdAt)}` : earlier;
}

/** The query's filters put back to nothing; the search text, sort and layout are left alone. */
export const NO_FILTERS = {
  found: 'all',
  stage: null,
  minScore: 0,
  sector: null,
  runId: null,
} as const satisfies Partial<LeadsQuery>;

/**
 * The fields of the Filters panel for the leads view: found range, stage (with counts), minimum
 * score, sort, layout and card density, plus chips for the sector and run folders. The same list
 * feeds the panel in the dashboard and in the expanded window.
 */
export function useLeadsFilters({
  query,
  onQuery,
  view,
  onView,
  density,
  onDensity,
  facets,
  runs,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  view: LeadsView;
  onView: (view: LeadsView) => void;
  density: Density;
  onDensity: (density: Density) => void;
  facets: CrmFacets | undefined;
  runs: readonly RunSummary[];
}) {
  const t = useT();
  return useMemo(() => {
    const stages = [...(facets?.stages ?? [])];
    // A stage that is chosen stays in the list even when nothing is in it any more.
    if (query.stage !== null && !stages.some((s) => s.key === query.stage)) {
      stages.push({ key: query.stage as BoardStageKey, count: 0 });
    }
    const stageName = (key: string) => t(`boardStage.${key}` as StringKey);
    const scoreText = (n: number) =>
      n === 0 ? t('filters.score.any') : t('filters.score.value', { score: n });
    const sectorName = facets?.sectors.find((s) => s.id === query.sector)?.name ?? query.sector;

    const fields: FilterField[] = [
      {
        id: 'found',
        type: 'choice',
        label: t('filters.found'),
        value: query.found,
        options: FOUND_WINDOWS.map((w) => ({ value: w, label: t(`leads.found.${w}`) })),
        onChange: (found) => onQuery({ found: found as LeadsQuery['found'] }),
        filter: {
          active: query.found !== 'all',
          chip: t('filters.chip.found', { value: t(`leads.found.${query.found}`) }),
          clear: () => onQuery({ found: 'all' }),
        },
      },
      {
        id: 'stage',
        type: 'choice',
        label: t('filters.stage'),
        value: query.stage ?? 'all',
        options: [
          { value: 'all', label: t('leads.stage.all'), count: facets?.total ?? 0 },
          ...stages.map((s) => ({ value: s.key, label: stageName(s.key), count: s.count })),
        ],
        onChange: (stage) => onQuery({ stage: stage === 'all' ? null : stage }),
        filter: {
          active: query.stage !== null,
          chip: t('filters.chip.stage', { value: query.stage ? stageName(query.stage) : '' }),
          clear: () => onQuery({ stage: null }),
        },
      },
      {
        id: 'minScore',
        type: 'range',
        label: t('filters.score'),
        value: query.minScore,
        min: 0,
        max: SCORE_MAX,
        step: SCORE_STEP,
        valueText: scoreText(query.minScore),
        onChange: (minScore) => onQuery({ minScore }),
        filter: {
          active: query.minScore > 0,
          chip: t('filters.chip.score', { value: scoreText(query.minScore) }),
          clear: () => onQuery({ minScore: 0 }),
        },
      },
      {
        id: 'sort',
        type: 'choice',
        label: t('filters.sort'),
        value: query.sort,
        options: LEAD_SORTS.map((s) => ({ value: s, label: t(`leads.sort.${s}`) })),
        onChange: (sort) => onQuery({ sort: sort as LeadsQuery['sort'], dir: undefined }),
      },
      {
        id: 'view',
        type: 'choice',
        label: t('filters.view'),
        value: view,
        options: [
          { value: 'grid', label: t('leads.view.grid') },
          { value: 'table', label: t('leads.view.table') },
        ],
        onChange: (v) => onView(v as LeadsView),
      },
      {
        id: 'density',
        type: 'choice',
        label: t('filters.density'),
        value: density,
        options: [
          { value: 'comfortable', label: t('filters.density.comfortable') },
          { value: 'compact', label: t('filters.density.compact') },
        ],
        onChange: (d) => onDensity(d as Density),
      },
    ];
    if (query.sector !== null) {
      fields.push({
        id: 'sector',
        type: 'tag',
        label: t('filters.sector'),
        filter: {
          active: true,
          chip: t('filters.chip.sector', { value: sectorName ?? '' }),
          clear: () => onQuery({ sector: null }),
        },
      });
    }
    if (query.runId !== null) {
      fields.push({
        id: 'run',
        type: 'tag',
        label: t('filters.run'),
        filter: {
          active: true,
          chip: t('filters.chip.run', {
            value: runLabel(runs, query.runId, t('leads.folders.earlierRun')),
          }),
          clear: () => onQuery({ runId: null }),
        },
      });
    }
    return fields;
  }, [query, onQuery, view, onView, density, onDensity, facets, runs, t]);
}
