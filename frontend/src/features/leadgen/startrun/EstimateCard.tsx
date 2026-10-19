import type { RunPreview } from '@lead-gen-crm/shared';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { KindTag } from '../../../components/Evidence.js';
import { EmptyState, ErrorState } from '../../../components/states.js';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { leadsRange } from './startPlan.js';

/** Dotted stand-in for a figure that is not known yet; it has the width of a real one. */
const DOTS = '·····';

/** One line of the receipt: label, dotted leader, value. */
function Row({
  label,
  children,
  big = false,
}: {
  label: ReactNode;
  children: ReactNode;
  big?: boolean;
}) {
  return (
    <div className={big ? 'receipt-row receipt-total' : 'receipt-row'}>
      <dt>{label}</dt>
      <span className="receipt-leader" aria-hidden="true" />
      <dd>{children}</dd>
    </div>
  );
}

/** Thin bars of varying width, for decoration only. */
const BARS = [
  2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 3, 1, 2, 2, 1, 3, 1, 4, 1, 2, 1, 1, 3,
];
function Barcode() {
  let x = 0;
  const bars = BARS.map((w, i) => {
    const bar = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={20} /> : null;
    x += w + 1;
    return bar;
  });
  return (
    <svg
      className="receipt-barcode"
      viewBox={`0 0 ${x} 20`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {bars}
    </svg>
  );
}

/**
 * The live estimate, drawn as a till receipt: itemised lines with dotted leaders, a bold total,
 * and the room left as small print. Nothing is spent by it. While figures are loading each line
 * shows dots of the same width, so nothing moves when they arrive.
 */
export function EstimateCard({
  ready,
  preview,
  loading,
  error,
  onRetry,
  cap,
}: {
  /** A region and a sector (or an extra search) are chosen, so there is something to estimate. */
  ready: boolean;
  preview: RunPreview | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** The cap typed so far, if it is a valid number. */
  cap: number | null;
}) {
  const t = useT();
  const range = preview ? leadsRange(preview.volume.leads) : null;
  const above = preview !== null && cap !== null && preview.cost.totalUsd > cap;
  const p = ready ? preview : null;
  const pending = p === null;

  return (
    <section className="receipt" aria-label={t('start.preview.title')}>
      <span className="receipt-tape" aria-hidden="true" />
      <div className="receipt-paper">
        <header className="receipt-head">
          <h3>{t('start.preview.title')}</h3>
          <span className="receipt-kind">
            {loading && !pending ? t('start.preview.loading') : <KindTag kind="estimate" />}
          </span>
        </header>
        {!ready ? (
          <EmptyState title={t('start.preview.pick')} />
        ) : error !== null && !preview ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : (
          <div
            className={loading ? 'receipt-body is-stale' : 'receipt-body'}
            aria-live="polite"
            aria-busy={pending}
          >
            {pending && (
              <p className="visually-hidden" role="status">
                {t('start.preview.loading')}
              </p>
            )}
            <dl className="receipt-lines">
              <Row label={t('start.preview.searches')}>{p ? p.queriesTotal : DOTS}</Row>
              <Row label={t('start.preview.places')}>{p ? Math.round(p.volume.places) : DOTS}</Row>
              <Row label={t('start.preview.qualified')}>
                {p ? Math.round(p.volume.qualified) : DOTS}
              </Row>
              <Row label={t('start.preview.leads')}>
                {p
                  ? range
                    ? t('start.preview.range', { low: range.low, high: range.high })
                    : t('start.preview.noData')
                  : DOTS}
              </Row>
              <Row label={t('start.preview.perLead')}>
                {p
                  ? p.cost.perLeadUsd === null
                    ? t('start.preview.noData')
                    : formatUsd(p.cost.perLeadUsd)
                  : DOTS}
              </Row>
            </dl>
            <dl className="receipt-sum">
              <Row
                big
                label={
                  <>
                    {t('start.preview.cost')}
                    {p && (
                      <Tip
                        label={t('start.preview.worstCase.label')}
                        text={t('start.preview.worstCase', {
                          amount: formatUsd(p.cost.upperBoundUsd),
                        })}
                      >
                        <Info size={14} aria-hidden="true" />
                      </Tip>
                    )}
                  </>
                }
              >
                {p ? formatUsd(p.cost.totalUsd) : '...'}
              </Row>
            </dl>
            {above && (
              <p className="receipt-stamp" role="alert">
                <span aria-hidden="true">{t('start.preview.stamp')}</span>
                <span className="visually-hidden">{t('start.preview.aboveCap')}</span>
              </p>
            )}
            {p && p.blockers.length > 0 && (
              <div className="state state-error" role="alert">
                <p className="state-title">{t('start.preview.blockers')}</p>
                <ul>
                  {p.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="receipt-small">
              <Row label={t('start.preview.activeRuns')}>
                {p ? `${p.limits.activeRuns} / ${p.limits.maxActiveRuns}` : DOTS}
              </Row>
              <Row label={t('start.preview.monthRemaining')}>
                {p
                  ? p.limits.monthRemainingUsd === null
                    ? t('start.preview.noMonthCap')
                    : formatUsd(p.limits.monthRemainingUsd)
                  : DOTS}
              </Row>
            </dl>
            <Barcode />
          </div>
        )}
      </div>
    </section>
  );
}
