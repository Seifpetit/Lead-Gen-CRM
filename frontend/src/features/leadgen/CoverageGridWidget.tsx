import type { Coverage, CoverageEntry } from '@lead-gen-crm/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../../api/context.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { Widget } from '../../components/Widget.js';
import { useT } from '../../i18n/index.js';
import { formatNumber, formatUsd } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import type { StartPrefill } from './prefill.js';

const SYMBOL = { not_searched: '', yielding: '●', saturated: '■' } as const;

/** Regions as rows, sectors as columns, coloured by state. Clicking a cell fills Start a run. */
export function CoverageGridWidget({
  refreshKey,
  onPick,
}: {
  refreshKey: number;
  onPick: (prefill: StartPrefill) => void;
}) {
  const t = useT();
  const api = useApi();
  const coverage = useResource(() => api.coverage.get(), { deps: [refreshKey] });
  const [active, setActive] = useState<CoverageEntry | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <Widget
      title={t('grid.title')}
      className={full ? 'widget-wide widget-fullscreen' : 'widget-wide'}
      actions={
        <button type="button" className="button" aria-pressed={full} onClick={() => setFull(!full)}>
          {full ? t('grid.fullscreen.exit') : t('grid.fullscreen')}
        </button>
      }
    >
      {coverage.error !== null && !coverage.data ? (
        <ErrorState error={coverage.error} onRetry={coverage.reload} />
      ) : !coverage.data ? (
        <LoadingState label={t('grid.loading')} />
      ) : (
        <Grid data={coverage.data} active={active} setActive={setActive} onPick={onPick} />
      )}
    </Widget>
  );
}

function Grid({
  data,
  active,
  setActive,
  onPick,
}: {
  data: Coverage;
  active: CoverageEntry | null;
  setActive: (e: CoverageEntry | null) => void;
  onPick: (prefill: StartPrefill) => void;
}) {
  const t = useT();
  const entry = (regionId: string, sectorId: string) =>
    data.entries.find((e) => e.regionId === regionId && e.sectorId === sectorId);
  const regionName = (id: string) => data.regions.find((r) => r.regionId === id)?.name ?? id;
  const sectorName = (id: string | null) =>
    id === null ? t('grid.other') : (data.sectors.find((s) => s.id === id)?.name ?? id);

  const describe = (e: CoverageEntry) =>
    t(`grid.state.${e.state}`) +
    (e.state === 'not_searched'
      ? ''
      : `. ${t('grid.detail', {
          queries: formatNumber(e.queriesRun),
          places: formatNumber(e.newPlaces),
          leads: formatNumber(e.leads),
          spend: formatUsd(e.spendUsd),
          perLead: e.costPerLeadUsd === null ? '—' : formatUsd(e.costPerLeadUsd),
        })}`);

  return (
    <>
      <ul className="legend" aria-label={t('grid.legend')}>
        {(['not_searched', 'yielding', 'saturated'] as const).map((s) => (
          <li key={s}>
            <span className={`swatch grid-${s}`} aria-hidden="true" /> {t(`grid.state.${s}`)}
          </li>
        ))}
      </ul>
      <div className="grid-scroll" role="group" aria-label={t('grid.title')}>
        <table className="coverage-grid">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">{t('grid.region')}</span>
              </th>
              {data.sectors.map((s) => (
                <th key={s.id} scope="col" title={s.name}>
                  <span className="vertical">{s.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.regions.map((r) => (
              <tr key={r.regionId}>
                <th scope="row">{r.name}</th>
                {data.sectors.map((s) => {
                  // No row means no search yet, which is still a square worth clicking.
                  const e: CoverageEntry = entry(r.regionId, s.id) ?? {
                    regionId: r.regionId,
                    sectorId: s.id,
                    queriesRun: 0,
                    newPlaces: 0,
                    leads: 0,
                    spendUsd: 0,
                    costPerLeadUsd: null,
                    state: 'not_searched',
                  };
                  const label = `${r.name}, ${s.name}: ${describe(e)}`;
                  return (
                    <td key={s.id}>
                      <button
                        type="button"
                        className={`grid-cell grid-${e.state}`}
                        title={label}
                        aria-label={label}
                        onMouseEnter={() => setActive(e)}
                        onMouseLeave={() => setActive(null)}
                        onFocus={() => setActive(e)}
                        onBlur={() => setActive(null)}
                        onClick={() => onPick({ regionId: r.regionId, sectorIds: [s.id] })}
                      >
                        {SYMBOL[e.state]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted grid-detail" role="status">
        {active
          ? `${regionName(active.regionId)}, ${sectorName(active.sectorId)}: ${describe(active)}`
          : t('grid.hint')}
      </p>
    </>
  );
}
