import type { Coverage, CoverageEntry, CoverageState } from '@lead-gen-crm/shared';
import { CircleCheck, CircleDashed, CircleDot, RefreshCw, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { sectorLook } from '../../features/crm/sectorLook.js';
import { useT } from '../../i18n/index.js';
import {
  columnTotal,
  compactValue,
  entryOf,
  intensity,
  metricMax,
  metricValue,
  type CoverageRow,
  type Metric,
} from '../../lib/coverageView.js';
import { formatDay, formatNumber, formatPercent, formatUsd } from '../../lib/format.js';
import { ProgressTrack } from './ProgressTrack.js';

/** A symbol per state, so a square never relies on its colour alone. */
export const STATE_ICON: Readonly<Record<CoverageState, LucideIcon>> = {
  not_searched: CircleDashed,
  yielding: CircleDot,
  saturated: CircleCheck,
  maintenance: RefreshCw,
};

export interface MatrixSelection {
  regionId: string | null;
  sectorId: string | null;
}

interface Tip {
  row: CoverageRow;
  sectorId: string;
  entry: CoverageEntry;
  at: CSSProperties;
}

/**
 * Regions as rows, sectors as columns (icons, named in tooltips), each square coloured by the
 * chosen metric: the search state, or leads, cost or yield on one scale. A region with nothing
 * to show yet stays in the list, greyed out and not selectable. One tab stop; arrow keys move
 * between squares. Takes everything as props and holds only the hover tooltip and the focus.
 */
export function CoverageMatrix({
  data,
  rows,
  metric,
  selected,
  onPlanRegion,
  onPlanSector,
  onSelectCell,
  size = 'normal',
}: {
  data: Coverage;
  /** Regions in display order, from coverageRows. */
  rows: readonly CoverageRow[];
  metric: Metric;
  selected: MatrixSelection;
  /** A region's title was activated: start a run in it. */
  onPlanRegion: (regionId: string) => void;
  /** A sector's icon at the head of a column was activated: start a run for it. */
  onPlanSector: (sectorId: string) => void;
  /** A square was activated. */
  onSelectCell: (regionId: string, sectorId: string) => void;
  size?: 'normal' | 'large';
}) {
  const t = useT();
  const [tip, setTip] = useState<Tip | null>(null);
  // Roving focus: one square or label is reachable by Tab; column 0 is the row label.
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const tipId = 'cov-matrix-tip';

  const sectors = data.sectors;
  const exploredIds = new Set(rows.filter((r) => r.explored).map((r) => r.regionId));
  const exploredEntries = data.entries.filter((e) => exploredIds.has(e.regionId));
  const max = metricMax(metric, exploredEntries);
  const sectorName = (id: string) => data.sectors.find((s) => s.id === id)?.name ?? id;

  const showTip = (el: HTMLElement, row: CoverageRow, sectorId: string, entry: CoverageEntry) => {
    const rect = el.getBoundingClientRect();
    const half = 130;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, half + 8),
      window.innerWidth - half - 8,
    );
    setTip({
      row,
      sectorId,
      entry,
      at:
        rect.top > 150
          ? { left, top: rect.top - 6, transform: 'translate(-50%, -100%)' }
          : { left, top: rect.bottom + 6, transform: 'translateX(-50%)' },
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const move: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    let { r, c } = focus;
    if (event.key in move) {
      const [dr, dc] = move[event.key]!;
      r = Math.min(rows.length - 1, Math.max(0, r + dr));
      c = Math.min(sectors.length, Math.max(0, c + dc));
    } else if (event.key === 'Home') {
      c = 0;
    } else if (event.key === 'End') {
      c = sectors.length;
    } else {
      return;
    }
    event.preventDefault();
    setFocus({ r, c });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-pos="${r}:${c}"]`)
      ?.focus({ preventScroll: false });
  }

  const stateLabel = (state: CoverageState) => t(`cov.state.${state}`);

  return (
    <div className={`cov-matrix-wrap is-${size}`}>
      <table
        className="cov-matrix"
        role="grid"
        aria-label={t('grid.title')}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setTip(null)}
      >
        <thead>
          <tr>
            <th scope="col" className="cov-corner">
              <span className="visually-hidden">{t('cov.region')}</span>
            </th>
            {sectors.map((s) => {
              const { Icon, color } = sectorLook(s.id);
              return (
                <th
                  key={s.id}
                  scope="col"
                  className={selected.sectorId === s.id ? 'is-selected' : undefined}
                >
                  <button
                    type="button"
                    className="cov-sector"
                    style={{ background: color }}
                    aria-label={t('cov.start.sector', { sector: s.name })}
                    title={s.name}
                    onClick={() => onPlanSector(s.id)}
                  >
                    <Icon size={size === 'large' ? 18 : 14} aria-hidden="true" />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="cov-bar-head">
              <span className="visually-hidden">{t('cov.bar.head')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const rowSelected = selected.regionId === row.regionId;
            return (
              <tr
                key={row.regionId}
                className={`${row.explored ? '' : 'is-grey'}${rowSelected ? ' is-selected' : ''}`}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="cov-region"
                    data-pos={`${r}:0`}
                    tabIndex={focus.r === r && focus.c === 0 ? 0 : -1}
                    aria-disabled={!row.explored}
                    aria-label={
                      row.explored ? t('cov.start.region', { region: row.name }) : undefined
                    }
                    title={row.explored ? undefined : t('cov.notExplored')}
                    onFocus={() => setFocus({ r, c: 0 })}
                    onClick={() => row.explored && onPlanRegion(row.regionId)}
                  >
                    {row.name}
                  </button>
                </th>
                {sectors.map((s, i) => {
                  const entry = entryOf(data, row.regionId, s.id);
                  const value = metricValue(metric, entry);
                  const level = intensity(value, max);
                  const chosen = rowSelected && selected.sectorId === s.id;
                  const Icon = STATE_ICON[entry.state];
                  const c = i + 1;
                  return (
                    <td key={s.id}>
                      <button
                        type="button"
                        className="cov-cell"
                        data-pos={`${r}:${c}`}
                        data-state={entry.state}
                        data-level={metric === 'status' ? undefined : level}
                        data-metric={metric}
                        data-grey={row.explored ? undefined : ''}
                        tabIndex={focus.r === r && focus.c === c ? 0 : -1}
                        aria-disabled={!row.explored}
                        aria-pressed={row.explored ? chosen : undefined}
                        aria-label={`${row.name}, ${s.name}, ${
                          row.explored ? stateLabel(entry.state) : t('cov.notExplored')
                        }`}
                        aria-describedby={
                          tip?.row === row && tip.sectorId === s.id ? tipId : undefined
                        }
                        onFocus={(e) => {
                          setFocus({ r, c });
                          showTip(e.currentTarget, row, s.id, entry);
                        }}
                        onBlur={() => setTip(null)}
                        onMouseEnter={(e) => showTip(e.currentTarget, row, s.id, entry)}
                        onClick={() => row.explored && onSelectCell(row.regionId, s.id)}
                      >
                        {row.explored &&
                          (metric === 'status' ? (
                            entry.state === 'not_searched' ? null : (
                              <Icon size={size === 'large' ? 16 : 13} aria-hidden="true" />
                            )
                          ) : (
                            <span className="cov-value">{compactValue(metric, value)}</span>
                          ))}
                      </button>
                    </td>
                  );
                })}
                <td className="cov-bar">
                  {row.explored && row.coverage !== null ? (
                    <ProgressTrack
                      size="thin"
                      tone="teal"
                      value={row.coverage}
                      label={t('cov.bar', { region: row.name })}
                      valueText={t('cov.bar.value', { percent: formatPercent(row.coverage) })}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t('cov.total')}</th>
            {sectors.map((s) => {
              const total = columnTotal(
                metric,
                rows.filter((r) => r.explored).map((r) => entryOf(data, r.regionId, s.id)),
              );
              return (
                <td key={s.id} className="cov-total">
                  {total === null ? '–' : formatTotal(metric, total)}
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
      {tip &&
        createPortal(
          <div id={tipId} role="tooltip" className="cov-tip" style={tip.at}>
            <strong>
              {tip.row.name}, {sectorName(tip.sectorId)}
            </strong>
            {tip.row.explored ? (
              <dl>
                <div>
                  <dt>{t('cov.state')}</dt>
                  <dd>{stateLabel(tip.entry.state)}</dd>
                </div>
                <div>
                  <dt>{t('cov.leads')}</dt>
                  <dd>{formatNumber(tip.entry.leads)}</dd>
                </div>
                <div>
                  <dt>{t('cov.cost')}</dt>
                  <dd>{formatUsd(tip.entry.spendUsd)}</dd>
                </div>
                <div>
                  <dt>{t('cov.lastRun')}</dt>
                  <dd>{tip.entry.lastRunAt ? formatDay(tip.entry.lastRunAt) : t('cov.never')}</dd>
                </div>
              </dl>
            ) : (
              <p>{t('cov.notExplored')}</p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function formatTotal(metric: Metric, value: number): string {
  if (metric === 'cost') return value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(1)}`;
  if (metric === 'yield') return value.toFixed(1);
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** The legend for the Status view: one symbol and colour per state. */
export function CoverageLegend() {
  const t = useT();
  return (
    <ul className="legend cov-legend" aria-label={t('cov.legend')}>
      {(['not_searched', 'yielding', 'saturated', 'maintenance'] as const).map((s) => {
        const Icon = STATE_ICON[s];
        return (
          <li key={s}>
            <span className="swatch cov-swatch" data-state={s} aria-hidden="true">
              <Icon size={10} />
            </span>{' '}
            {t(`cov.state.${s}`)}
          </li>
        );
      })}
    </ul>
  );
}
