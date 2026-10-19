import type { Coverage, CoverageEntry } from '@lead-gen-crm/shared';
import { sectorLook } from '../../features/crm/sectorLook.js';
import { useT } from '../../i18n/index.js';
import { entryOf, yieldOf } from '../../lib/coverageView.js';
import { formatDay, formatNumber, formatUsd } from '../../lib/format.js';
import { STATE_ICON } from './CoverageMatrix.js';

/**
 * One region on its own: a row per sector with its state, leads, cost, yield and last run, and
 * a button to plan a run for that sector. What the matrix turns into when a region is picked.
 */
export function CoverageRegionTable({
  data,
  regionId,
  regionName,
  onPlan,
}: {
  data: Coverage;
  regionId: string;
  regionName: string;
  /** Plan a run here: the sector's id, or null for the typed-in searches. */
  onPlan: (sectorId: string | null) => void;
}) {
  const t = useT();
  const rows: { id: string | null; name: string; entry: CoverageEntry }[] = data.sectors.map(
    (s) => ({ id: s.id, name: s.name, entry: entryOf(data, regionId, s.id) }),
  );
  // Searches typed in by hand have no sector; they only show up when something landed there.
  const other = data.entries.find((e) => e.regionId === regionId && e.sectorId === null);
  if (other) rows.push({ id: null, name: t('grid.other'), entry: other });

  return (
    <div className="cov-table-wrap">
      <table className="cov-table" aria-label={t('cov.table.title', { region: regionName })}>
        <thead>
          <tr>
            <th scope="col">{t('cov.sector')}</th>
            <th scope="col">{t('cov.state')}</th>
            <th scope="col" className="num">
              {t('cov.leads')}
            </th>
            <th scope="col" className="num">
              {t('cov.cost')}
            </th>
            <th scope="col" className="num">
              {t('cov.yield')}
            </th>
            <th scope="col">{t('cov.lastRun')}</th>
            <th scope="col">
              <span className="visually-hidden">{t('cov.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, entry }) => {
            const { Icon: SectorIcon, color } = sectorLook(id);
            const StateIcon = STATE_ICON[entry.state];
            const y = yieldOf(entry);
            return (
              <tr key={id ?? 'other'}>
                <th scope="row">
                  <span className="cov-name">
                    <span
                      className="cov-sector is-inline"
                      style={{ background: color }}
                      aria-hidden="true"
                    >
                      <SectorIcon size={14} />
                    </span>
                    {name}
                  </span>
                </th>
                <td>
                  <span className="cov-state" data-state={entry.state}>
                    <StateIcon size={14} aria-hidden="true" />
                    {t(`cov.state.${entry.state}`)}
                  </span>
                </td>
                <td className="num">{formatNumber(entry.leads)}</td>
                <td className="num">{formatUsd(entry.spendUsd)}</td>
                <td className="num">{y === null ? '–' : y.toFixed(1)}</td>
                <td>{entry.lastRunAt ? formatDay(entry.lastRunAt) : t('cov.never')}</td>
                <td>
                  {id !== null && (
                    <button
                      type="button"
                      className="button"
                      aria-label={t('cov.plan.for', { region: regionName, sector: name })}
                      onClick={() => onPlan(id)}
                    >
                      {t('cov.plan')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
