import type { Lead } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../../api/context.js';
import { Breadcrumb } from '../../components/shared/Breadcrumb.js';
import { useToast } from '../../components/shared/Toast.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { LeadDetailCard } from './LeadDetailCard.js';

const PAGE = 100;
const MAX_PAGES = 10;

interface Found {
  lead: Lead | null;
  region: string;
}

/** One lead on its own page. The API has no call for a single lead, so it is found in its run. */
export function LeadPage() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const { runId = '', leadId = '' } = useParams();
  const [moved, setMoved] = useState<Lead | null>(null);

  const found = useResource<Found>(
    async () => {
      const run = await api.runs.get(runId);
      let lead = run.leads.find((l) => l.id === leadId) ?? null;
      let offset: number | null = lead ? null : run.leads.length;
      for (let i = 0; i < MAX_PAGES && lead === null && offset !== null; i++) {
        const page = await api.leads.list({ runId, limit: PAGE, offset });
        lead = page.items.find((l) => l.id === leadId) ?? null;
        offset = page.nextOffset;
      }
      return { lead, region: run.region };
    },
    { deps: [runId, leadId] },
  );

  const lead = moved ?? found.data?.lead ?? null;
  const region = found.data?.region ?? '';
  const crumbs = [
    { label: t('side.dashboard'), to: '/leadgen' },
    ...(found.data ? [{ label: t('run.title', { region }), to: `/leadgen/runs/${runId}` }] : []),
    { label: lead?.company.name ?? t('crumb.lead') },
  ];

  return (
    <main id="main" className="page">
      <Breadcrumb label={t('crumb.label')} backLabel={t('common.back')} crumbs={crumbs} />
      {found.loading && !found.data ? (
        <LoadingState />
      ) : found.error !== null && !found.data ? (
        <ErrorState error={found.error} onRetry={found.reload} />
      ) : lead === null ? (
        <EmptyState title={t('leadPage.missing')} />
      ) : (
        <LeadDetailCard
          lead={lead}
          onMoved={(next, note) => {
            setMoved(next);
            if (note) toast.show(note);
          }}
        />
      )}
    </main>
  );
}
