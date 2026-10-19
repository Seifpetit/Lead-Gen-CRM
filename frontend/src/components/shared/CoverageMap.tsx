import type { CellSummary, RegionGeometry } from '@lead-gen-crm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { formatDateTime, formatNumber, formatUsd } from '../../lib/format.js';
import {
  cellState,
  makeProjection,
  outlinePath,
  padBounds,
  unionBounds,
  type CellState,
  type LatLngBounds,
  type Projection,
} from '../../lib/mapGeometry.js';
import { ErrorState, LoadingState } from '../states.js';

const CELL_STATES: CellState[] = ['never', 'claimed', 'searched', 'leads', 'saturated'];
const ZOOM_MS = 380;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (b: LatLngBounds, p: Projection): Box => {
  const x = p.x(b.west);
  const y = p.y(b.north);
  return { x, y, w: Math.max(p.x(b.east) - x, 1), h: Math.max(p.y(b.south) - y, 1) };
};

/** The viewBox eased from where it is to `target`; at once when motion is reduced. */
function useEasedBox(target: Box): Box {
  const [box, setBox] = useState(target);
  const current = useRef(box);
  current.current = box;
  useEffect(() => {
    const from = current.current;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame !== 'function') {
      setBox(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - Math.pow(1 - k, 3);
      setBox({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, target.w, target.h]);
  return box;
}

/**
 * Tunisia drawn from the governorate outlines, no map tiles. Picking a region zooms to it
 * (smoothly), outlines it and dims the others, and shows its search cells; picking nothing
 * shows the whole country. A region with nothing to show yet is greyed out and cannot be picked.
 * Takes its data as props; what is picked belongs to the caller.
 */
export function CoverageMap({
  regions,
  exploredIds,
  regionId,
  onRegionChange,
  cells,
  cellsLoading = false,
  cellsError = null,
  onRetryCells,
  onPlanCell,
}: {
  regions: RegionGeometry[];
  /** The regions that can be picked; the others are greyed out. */
  exploredIds: ReadonlySet<string>;
  /** The picked region, or null for the whole country. */
  regionId: string | null;
  onRegionChange: (regionId: string) => void;
  /** The picked region's cells; null until loaded. */
  cells: CellSummary[] | null;
  cellsLoading?: boolean;
  cellsError?: unknown;
  onRetryCells?: () => void;
  /** Plan a run in one cell of the picked region. */
  onPlanCell: (regionId: string, cellKey: string) => void;
}) {
  const t = useT();
  const [cellKey, setCellKey] = useState<string | null>(null);
  useEffect(() => setCellKey(null), [regionId]);

  const drawable = regions.filter((r) => r.outline && r.bounds);
  const missing = regions.filter((r) => !r.outline);
  const region = drawable.find((r) => r.regionId === regionId) ?? null;
  const regionCells = region ? (cells ?? []) : [];
  const selectedCell = regionCells.find((c) => c.cellKey === cellKey) ?? null;

  const whole = useMemo(() => {
    const u = unionBounds(drawable.map((r) => r.bounds!));
    return u ? padBounds(u) : null;
  }, [drawable.length]);
  const projection = useMemo(() => (whole ? makeProjection(whole) : null), [whole]);

  const target: Box = useMemo(() => {
    if (!projection || !whole) return { x: 0, y: 0, w: 1, h: 1 };
    if (!region?.bounds) return { x: 0, y: 0, w: projection.width, h: projection.height };
    const withCells = unionBounds([region.bounds, ...regionCells.map((c) => c.bounds)])!;
    return boxOf(padBounds(withCells, 0.1), projection);
  }, [projection, whole, region, regionCells.length]);
  const box = useEasedBox(target);

  if (!projection) return <p className="muted">{t('map.noGeometry')}</p>;
  const pick = (id: string) => exploredIds.has(id) && onRegionChange(id);

  return (
    <div className="cov-map">
      <svg
        className="coverage-map"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={t('map.title')}
        data-focus={regionId ?? ''}
      >
        {drawable.map((r) => {
          const explored = exploredIds.has(r.regionId);
          const chosen = r.regionId === regionId;
          const classes = [
            'region-shape',
            chosen ? 'is-selected' : '',
            regionId !== null && !chosen ? 'is-dimmed' : '',
            explored ? '' : 'is-grey',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <path
              key={r.regionId}
              d={outlinePath(r.outline!, projection)}
              fillRule="evenodd"
              className={classes}
              role="button"
              tabIndex={explored ? 0 : -1}
              aria-label={t('map.regionShape', { region: r.name })}
              aria-pressed={explored ? chosen : undefined}
              aria-disabled={!explored}
              onClick={() => pick(r.regionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(r.regionId);
                }
              }}
            >
              <title>{explored ? r.name : `${r.name}: ${t('cov.notExplored')}`}</title>
            </path>
          );
        })}
        {regionCells.map((c) => {
          const state = cellState(c);
          const x = projection.x(c.bounds.west);
          const y = projection.y(c.bounds.north);
          return (
            <rect
              key={c.regionCellId}
              x={x}
              y={y}
              width={Math.max(projection.x(c.bounds.east) - x, 0.5)}
              height={Math.max(projection.y(c.bounds.south) - y, 0.5)}
              className={`map-cell cell-${state}${c.cellKey === cellKey ? ' is-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={t('map.cellShape', { cell: c.cellKey, state: t(`map.state.${state}`) })}
              aria-pressed={c.cellKey === cellKey}
              onClick={() => setCellKey(c.cellKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCellKey(c.cellKey);
                }
              }}
            >
              <title>{`${c.cellKey}: ${t(`map.state.${state}`)}`}</title>
            </rect>
          );
        })}
      </svg>
      {regionCells.length > 0 && (
        <ul className="legend cov-map-legend" aria-label={t('map.legend')}>
          {CELL_STATES.map((s) => (
            <li key={s}>
              <span className={`swatch cell-${s}`} aria-hidden="true" /> {t(`map.state.${s}`)}
            </li>
          ))}
        </ul>
      )}
      <div className="cov-map-notes" data-keep="">
        {regionId !== null && cellsError !== null && !cells && (
          <ErrorState error={cellsError} {...(onRetryCells ? { onRetry: onRetryCells } : {})} />
        )}
        {regionId !== null && cellsLoading && !cells && (
          <LoadingState label={t('map.cells.loading')} />
        )}
        {region && cells && cells.length === 0 && (
          <p className="muted">{t('map.cells.none', { region: region.name })}</p>
        )}
        {selectedCell ? (
          <CellStats
            cell={selectedCell}
            onPlan={() => onPlanCell(regionId!, selectedCell.cellKey)}
          />
        ) : (
          <p className="muted">{region ? t('map.hint.reset') : t('map.hint.region')}</p>
        )}
        {missing.length > 0 && (
          <p className="muted">
            {t('map.missing', { regions: missing.map((r) => r.name).join(', ') })}
          </p>
        )}
      </div>
    </div>
  );
}

function CellStats({ cell, onPlan }: { cell: CellSummary; onPlan: () => void }) {
  const t = useT();
  const state = cellState(cell);
  return (
    <section
      className="cell-stats"
      aria-label={t('map.cell.title', { cell: cell.cellKey })}
      aria-live="polite"
    >
      <h3>
        {t('map.cell.title', { cell: cell.cellKey })}{' '}
        <span className="badge">{t(`map.state.${state}`)}</span>
      </h3>
      <dl className="stats">
        <div>
          <dt>{t('map.cell.queries')}</dt>
          <dd>{formatNumber(cell.queriesRun)}</dd>
        </div>
        <div>
          <dt>{t('map.cell.newPlaces')}</dt>
          <dd>{formatNumber(cell.newPlacesFound)}</dd>
        </div>
        <div>
          <dt>{t('map.cell.leads')}</dt>
          <dd>{formatNumber(cell.leads)}</dd>
        </div>
        <div>
          <dt>{t('map.cell.spend')}</dt>
          <dd>{formatUsd(cell.spendUsd)}</dd>
        </div>
        <div>
          <dt>{t('map.cell.lastRun')}</dt>
          <dd>{cell.lastRunAt ? formatDateTime(cell.lastRunAt) : t('map.cell.never')}</dd>
        </div>
      </dl>
      <button type="button" className="button" onClick={onPlan}>
        {t('cov.plan.cell')}
      </button>
    </section>
  );
}
