import type { RunPreview } from '@lead-gen-crm/shared';
import { Info, TriangleAlert } from 'lucide-react';
import { KindTag } from '../../../components/Evidence.js';
import { Card } from '../../../components/shared/Card.js';
import { EmptyState, ErrorState } from '../../../components/states.js';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { leadsRange } from './startPlan.js';

/**
 * The live estimate beside the form: cost, expected leads and cost per lead, a warning when the
 * cost is above the cap, and the room left (active runs, this month). Nothing is spent by it.
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

  return (
    <Card title={t('start.preview.title')} tone="sky" className="sr-estimate">
      {!ready ? (
        <EmptyState title={t('start.preview.pick')} />
      ) : error !== null && !preview ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !preview ? (
        <p className="state state-loading" role="status">
          {t('start.preview.loading')}
        </p>
      ) : (
        <div
          className={loading ? 'sr-estimate-body is-stale' : 'sr-estimate-body'}
          aria-live="polite"
        >
          <p className="sr-loading muted" role="status">
            {loading ? t('start.preview.loading') : <KindTag kind="estimate" />}
          </p>
          <dl className="sr-figures">
            <div>
              <dt>
                {t('start.preview.cost')}
                <Tip
                  label={t('start.preview.worstCase.label')}
                  text={t('start.preview.worstCase', {
                    amount: formatUsd(preview.cost.upperBoundUsd),
                  })}
                >
                  <Info size={14} aria-hidden="true" />
                </Tip>
              </dt>
              <dd className="sr-big">{formatUsd(preview.cost.totalUsd)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.leads')}</dt>
              <dd className="sr-big">
                {range
                  ? t('start.preview.range', { low: range.low, high: range.high })
                  : t('start.preview.noData')}
              </dd>
            </div>
            <div>
              <dt>{t('start.preview.perLead')}</dt>
              <dd className="sr-big">
                {preview.cost.perLeadUsd === null
                  ? t('start.preview.noData')
                  : formatUsd(preview.cost.perLeadUsd)}
              </dd>
            </div>
          </dl>
          {above && (
            <p className="sr-warn" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              {t('start.preview.aboveCap')}
            </p>
          )}
          {preview.blockers.length > 0 && (
            <div className="state state-error" role="alert">
              <p className="state-title">{t('start.preview.blockers')}</p>
              <ul>
                {preview.blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="sr-room">
            <div>
              <dt>{t('start.preview.activeRuns')}</dt>
              <dd>
                {preview.limits.activeRuns} / {preview.limits.maxActiveRuns}
              </dd>
            </div>
            <div>
              <dt>{t('start.preview.monthRemaining')}</dt>
              <dd>
                {preview.limits.monthRemainingUsd === null
                  ? t('start.preview.noMonthCap')
                  : formatUsd(preview.limits.monthRemainingUsd)}
              </dd>
            </div>
          </dl>
          <p className="muted sr-note">{t('start.preview.free')}</p>
        </div>
      )}
    </Card>
  );
}
