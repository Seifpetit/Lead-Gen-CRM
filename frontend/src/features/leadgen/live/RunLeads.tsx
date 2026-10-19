import type { Lead } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { useT } from '../../../i18n/index.js';
import { LeadDetailCard } from '../LeadDetailCard.js';
import type { RunLeads as RunLeadsState } from './useRunLeads.js';

/** The leads of the chosen runs as cards, best first, with "Show more" while there are more. */
export function RunLeads({
  state,
  running,
}: {
  state: RunLeadsState;
  /** At least one of the runs is still going, so more leads may come. */
  running: boolean;
}) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);

  if (state.loading && state.leads.length === 0) return <LoadingState />;
  if (state.error !== null && state.leads.length === 0) return <ErrorState error={state.error} />;
  if (state.leads.length === 0) {
    return (
      <EmptyState title={t('run.leads.empty.title')}>
        {running ? t('run.leads.empty.running') : t('run.leads.empty.done')}
      </EmptyState>
    );
  }
  return (
    <>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      <p className="muted">
        {t('run.leads.count', { shown: state.leads.length, total: state.total })}
      </p>
      <div className="lead-list">
        {state.leads.map((lead) => (
          <LeadDetailCard
            key={lead.id}
            lead={lead}
            onMoved={(moved: Lead, message: string | null) => {
              state.replace(moved);
              setNote(message);
            }}
          />
        ))}
      </div>
      {state.moreError !== null && <ErrorState error={state.moreError} onRetry={state.loadMore} />}
      {state.hasMore && (
        <button
          type="button"
          className="button"
          disabled={state.loadingMore}
          onClick={state.loadMore}
        >
          {state.loadingMore ? t('common.loading') : t('common.showMore')}
        </button>
      )}
    </>
  );
}
