import type { Lead } from '@lead-gen-crm/shared';
import { useParams } from 'react-router';
import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { LeadView } from './lead/LeadView.js';

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
  const { runId = '', leadId = '' } = useParams();

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
  const lead = found.data?.lead ?? null;
  // The company's card, notes and history come from the CRM; they follow the lead's company.
  const detail = useResource((signal) => api.crm.companyDetail(lead?.company.id ?? '', signal), {
    enabled: lead !== null,
    deps: [lead?.company.id],
  });

  return (
    <main id="main" className="page fit lead-page">
      {found.loading && !found.data ? (
        <LoadingState />
      ) : found.error !== null && !found.data ? (
        <ErrorState error={found.error} onRetry={found.reload} />
      ) : lead === null ? (
        <EmptyState title={t('leadPage.missing')} />
      ) : detail.data === null ? (
        detail.error !== null ? (
          <ErrorState error={detail.error} onRetry={detail.reload} />
        ) : (
          <LoadingState />
        )
      ) : (
        <LeadView
          lead={lead}
          detail={{ ...detail, data: detail.data }}
          backTo={`/leadgen/runs/${runId}`}
        />
      )}
    </main>
  );
}
