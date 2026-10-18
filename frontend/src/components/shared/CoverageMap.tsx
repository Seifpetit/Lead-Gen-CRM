import type { CellSummary, RegionGeometry } from '@lead-gen-crm/shared';
import { useMemo, useState } from 'react';
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
} from '../../lib/mapGeometry.js';
import { ErrorState, LoadingState } from '../states.js';

const STATES: CellState[] = ['never', 'claimed', 'searched', 'leads', 'saturated'];

/**
 * Tunisia drawn from the governorate outlines, no map tiles, coloured by search state. Click a
 * region to zoom to its search cells; click a cell for its stats. Takes its data as props: the
 * outlines, and the cells of the selected region once they are loaded.
 */
export function CoverageMap({
  regions,
  regionId,
  onRegionChange,
  cells,
  cellsLoading = false,
  cellsError = null,
  onRetryCells,
  onPick,
}: {
  regions: RegionGeometry[];
  /** The selected region, or null for the whole country. */
  regionId: string | null;
  onRegionChange: (regionId: string | null) => void;
  /** The selected region's cells; null until loaded. */
  cells: CellSummary[] | null;
  cellsLoading?: boolean;
  cellsError?: unknown;
  onRetryCells?: () => void;
  /** Called with the region and cell when a cell is clicked. */
  onPick: (pick: { regionId: string; cellKeys: string[] }) => void;
}) {
  const t = useT();
  const [cellKey, setCellKey] = useState<string | null>(null);

  const drawable = regions.filter((r) => r.outline && r.bounds);
  const missing = regions.filter((r) => !r.outline);
  const region = drawable.find((r) => r.regionId === regionId) ?? null;
  const regionCells = regionId !== null ? (cells ?? []) : [];
  const selectedCell = regionCells.find((c) => c.cellKey === cellKey) ?? null;

  const view: LatLngBounds | null = useMemo(() => {
    if (region?.bounds) {
      const cellBounds = regionCells.map((c) => c.bounds);
      return padBounds(unionBounds([region.bounds, ...cellBounds])!);
    }
    const all = drawable.map((r) => r.bounds!);
    const u = unionBounds(all);
    return u ? padBounds(u) : null;
  }, [region, regionCells.length, drawable.length]);

  function chooseRegion(id: string | null) {
    onRegionChange(id);
    setCellKey(null);
  }

  if (view === null) return <p className="muted">{t('map.noGeometry')}</p>;
  return (
    <>
      <div className="form-field map-select">
        <label htmlFor="map-region">{t('map.region')}</label>
        <select
          id="map-region"
          value={regionId ?? ''}
          onChange={(e) => chooseRegion(e.target.value || null)}
        >
          <option value="">{t('map.all')}</option>
          {drawable.map((r) => (
            <option key={r.regionId} value={r.regionId}>
              {r.name}
            </option>
          ))}
        </select>
        {regionId !== null && (
          <button type="button" className="button" onClick={() => chooseRegion(null)}>
            {t('map.back')}
          </button>
        )}
      </div>
      <Legend />
      <MapSvg
        view={view}
        regions={drawable}
        selected={regionId}
        cells={regionCells}
        cellKey={cellKey}
        onRegion={chooseRegion}
        onCell={(c) => {
          setCellKey(c.cellKey);
          onPick({ regionId: regionId!, cellKeys: [c.cellKey] });
        }}
      />
      {regionId !== null && cellsError !== null && !cells && (
        <ErrorState error={cellsError} {...(onRetryCells ? { onRetry: onRetryCells } : {})} />
      )}
      {regionId !== null && cellsLoading && !cells && (
        <LoadingState label={t('map.cells.loading')} />
      )}
      {regionId !== null && cells && cells.length === 0 && (
        <p className="muted">{t('map.cells.none', { region: region?.name ?? regionId })}</p>
      )}
      {selectedCell ? (
        <CellStats cell={selectedCell} />
      ) : (
        <p className="muted">{regionId ? t('map.hint.cell') : t('map.hint.region')}</p>
      )}
      {missing.length > 0 && (
        <p className="muted">
          {t('map.missing', { regions: missing.map((r) => r.name).join(', ') })}
        </p>
      )}
    </>
  );
}

function Legend() {
  const t = useT();
  return (
    <ul className="legend" aria-label={t('map.legend')}>
      {STATES.map((s) => (
        <li key={s}>
          <span className={`swatch cell-${s}`} aria-hidden="true" /> {t(`map.state.${s}`)}
        </li>
      ))}
    </ul>
  );
}

function MapSvg({
  view,
  regions,
  selected,
  cells,
  cellKey,
  onRegion,
  onCell,
}: {
  view: LatLngBounds;
  regions: RegionGeometry[];
  selected: string | null;
  cells: CellSummary[];
  cellKey: string | null;
  onRegion: (id: string) => void;
  onCell: (c: CellSummary) => void;
}) {
  const t = useT();
  const p = makeProjection(view);
  return (
    <svg
      className="coverage-map"
      viewBox={`0 0 ${p.width} ${p.height}`}
      role="group"
      aria-label={t('map.title')}
    >
      {regions.map((r) => (
        <path
          key={r.regionId}
          d={outlinePath(r.outline!, p)}
          fillRule="evenodd"
          className={`region-shape${r.regionId === selected ? ' is-selected' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={t('map.regionShape', { region: r.name })}
          aria-pressed={r.regionId === selected}
          onClick={() => onRegion(r.regionId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRegion(r.regionId);
            }
          }}
        >
          <title>{r.name}</title>
        </path>
      ))}
      {cells.map((c) => {
        const state = cellState(c);
        const x = p.x(c.bounds.west);
        const y = p.y(c.bounds.north);
        return (
          <rect
            key={c.regionCellId}
            x={x}
            y={y}
            width={Math.max(p.x(c.bounds.east) - x, 0.5)}
            height={Math.max(p.y(c.bounds.south) - y, 0.5)}
            className={`map-cell cell-${state}${c.cellKey === cellKey ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={t('map.cellShape', { cell: c.cellKey, state: t(`map.state.${state}`) })}
            aria-pressed={c.cellKey === cellKey}
            onClick={() => onCell(c)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCell(c);
              }
            }}
          >
            <title>{`${c.cellKey}: ${t(`map.state.${state}`)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function CellStats({ cell }: { cell: CellSummary }) {
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
          <dt>{t('map.cell.places')}</dt>
          <dd>{formatNumber(cell.placesFound)}</dd>
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
      <p className="muted">{t('map.cell.selected')}</p>
    </section>
  );
}
