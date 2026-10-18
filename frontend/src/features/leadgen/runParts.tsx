import type { RunFunnel, RunStatus, RunSummary } from '@lead-gen-crm/shared';
import { useT, type StringKey } from '../../i18n/index.js';
import { formatNumber, formatUsd } from '../../lib/format.js';

export const ACTIVE_STATUSES: readonly RunStatus[] = ['pending', 'running'];
export const isActive = (status: RunStatus) => ACTIVE_STATUSES.includes(status);

export function StatusBadge({ status }: { status: RunStatus }) {
  const t = useT();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

const FUNNEL_ORDER: (keyof RunFunnel)[] = [
  'discovered',
  'skipped',
  'qualified',
  'rejected',
  'review',
  'peopleFound',
  'enriched',
  'scored',
  'leads',
];

/** Counts per funnel stage as a description list, so each count keeps its label. */
export function FunnelCounts({
  funnel,
  compact = false,
}: {
  funnel: RunFunnel;
  compact?: boolean;
}) {
  const t = useT();
  const keys = compact
    ? FUNNEL_ORDER.filter((k) => ['discovered', 'qualified', 'peopleFound', 'leads'].includes(k))
    : FUNNEL_ORDER;
  return (
    <dl className="funnel">
      {keys.map((key) => (
        <div key={key}>
          <dt>{t(`funnel.${key}` as StringKey)}</dt>
          <dd>{formatNumber(funnel[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SpendMeter({ run }: { run: Pick<RunSummary, 'spentUsd' | 'budgetCapUsd'> }) {
  const t = useT();
  const cap = run.budgetCapUsd;
  const share = cap > 0 ? Math.min(1, run.spentUsd / cap) : 0;
  return (
    <div className="spend">
      <span>{t('money.spentOfCap', { spent: formatUsd(run.spentUsd), cap: formatUsd(cap) })}</span>
      <progress max={1} value={share} aria-hidden="true" />
    </div>
  );
}
