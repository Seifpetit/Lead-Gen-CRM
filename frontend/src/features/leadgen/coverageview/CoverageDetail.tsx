import type { CoverageEntry } from '@lead-gen-crm/shared';
import { X } from 'lucide-react';
import { STATE_ICON } from '../../../components/shared/CoverageMatrix.js';
import { useT } from '../../../i18n/index.js';
import { yieldOf } from '../../../lib/coverageView.js';
import { formatDay, formatNumber, formatUsd } from '../../../lib/format.js';

/**
 * The numbers for one region and sector, under the matrix, with the way to plan a run for it.
 * Sits inside the panel (it replaces nothing, so the page never grows).
 */
export function CoverageDetail({
  regionName,
  sectorName,
  entry,
  onPlan,
  onClose,
}: {
  regionName: string;
  sectorName: string;
  entry: CoverageEntry;
  onPlan: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const StateIcon = STATE_ICON[entry.state];
  const y = yieldOf(entry);
  return (
    <section
      className="cov-detail"
      data-keep=""
      aria-label={t('cov.detail.title', { region: regionName, sector: sectorName })}
    >
      <header>
        <h3>{t('cov.detail.title', { region: regionName, sector: sectorName })}</h3>
        <span className="cov-state" data-state={entry.state}>
          <StateIcon size={14} aria-hidden="true" />
          {t(`cov.state.${entry.state}`)}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('cov.detail.close')}
          title={t('cov.detail.close')}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <dl className="stats">
        <div>
          <dt>{t('cov.leads')}</dt>
          <dd>{formatNumber(entry.leads)}</dd>
        </div>
        <div>
          <dt>{t('cov.cost')}</dt>
          <dd>{formatUsd(entry.spendUsd)}</dd>
        </div>
        <div>
          <dt>{t('cov.yield')}</dt>
          <dd>{y === null ? '–' : y.toFixed(1)}</dd>
        </div>
        <div>
          <dt>{t('cov.lastRun')}</dt>
          <dd>{entry.lastRunAt ? formatDay(entry.lastRunAt) : t('cov.never')}</dd>
        </div>
      </dl>
      <button type="button" className="button button-primary" onClick={onPlan}>
        {t('cov.plan')}
      </button>
    </section>
  );
}
