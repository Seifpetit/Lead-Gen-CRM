import type { Coverage, CoverageEntry } from '@lead-gen-crm/shared';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { formatNumber, formatUsd } from '../../lib/format.js';
import { ToggleGroup } from './ToggleGroup.js';

const SYMBOL = { not_searched: '', yielding: '●', saturated: '■' } as const;

/**
 * Regions as rows, sectors as columns, each square coloured by its search state. Takes the
 * coverage data as props; has a Normal / Fullscreen switch (Escape leaves fullscreen).
 */
export function CoverageMatrix({
  data,
  onPick,
}: {
  data: Coverage;
  /** Called with the region and sector of the square that was clicked. */
  onPick: (pick: { regionId: string; sectorIds: string[] }) => void;
}) {
  const t = useT();
  const [active, setActive] = useState<CoverageEntry | null>(null);
  const [size, setSize] = useState<'normal' | 'full'>('normal');

  useEffect(() => {
    if (size !== 'full') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSize('normal');
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [size]);

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
    <div className={size === 'full' ? 'matrix-view is-fullscreen' : 'matrix-view'}>
      <ToggleGroup
        label={t('grid.size')}
        value={size}
        onChange={setSize}
        options={[
          { value: 'normal', label: t('grid.size.normal') },
          { value: 'full', label: t('grid.size.full') },
        ]}
      />
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
    </div>
  );
}
