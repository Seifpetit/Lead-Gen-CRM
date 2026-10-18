import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Card } from '../../components/shared/Card.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { RunLog } from './RunLog.js';

export const APIFY_LOG_POLL_MS = 5_000;

/** The state of current Apify runs, refreshed by polling. */
export function ApifyLogWidget({ refreshKey }: { refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const log = useResource(() => api.apify.log({ runs: 5, limit: 10 }), {
    pollMs: APIFY_LOG_POLL_MS,
    deps: [refreshKey],
  });

  const data = log.data;
  return (
    <Card
      title={t('apify.title')}
      className="widget-medium"
      actions={
        <button type="button" className="button" onClick={log.reload}>
          {t('common.refresh')}
        </button>
      }
    >
      {log.loading && !data ? (
        <LoadingState />
      ) : log.error !== null && !data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : !data || data.runs.length === 0 ? (
        <EmptyState title={t('apify.empty.title')}>{t('apify.empty.body')}</EmptyState>
      ) : (
        <>
          {log.error !== null && (
            <p className="notice notice-warning" role="status">
              {t('apify.stale')}
            </p>
          )}
          {data.attention.length > 0 && (
            <p className="notice notice-warning" role="status">
              {data.attention.length === 1
                ? t('apify.attention', { count: data.attention.length })
                : t('apify.attentionMany', { count: data.attention.length })}
            </p>
          )}
          <ul className="log-runs">
            {data.runs.map((entry) => (
              <RunLog key={entry.run.id} entry={entry} />
            ))}
          </ul>
          <p className="muted small">
            {t('apify.polling', { seconds: APIFY_LOG_POLL_MS / 1000 })}
            {log.updatedAt &&
              ` · ${t('common.updatedAt', { time: log.updatedAt.toLocaleTimeString('en-GB') })}`}
          </p>
        </>
      )}
    </Card>
  );
}
