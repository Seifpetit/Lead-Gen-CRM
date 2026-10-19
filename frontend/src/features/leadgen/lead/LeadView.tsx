import type { CompanyCardDetail, Lead } from '@lead-gen-crm/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Card } from '../../../components/shared/Card.js';
import { Tabs } from '../../../components/shared/Tabs.js';
import { useToast } from '../../../components/shared/Toast.js';
import { useT } from '../../../i18n/index.js';
import type { Resource } from '../../../lib/useResource.js';
import { AddDecisionMakerModal } from '../../crm/AddDecisionMakerModal.js';
import { CompanyThumb } from '../../crm/BoardCard.js';
import { EvidenceTab } from './EvidenceTab.js';
import { IdentityColumn } from './IdentityColumn.js';
import { LocationCard } from './LocationCard.js';
import { NotesTab } from './NotesTab.js';
import { OverviewTab } from './OverviewTab.js';
import { ScoreTab } from './ScoreTab.js';

const TABS = ['overview', 'score', 'evidence', 'notes'] as const;
type Tab = (typeof TABS)[number];

/** Back goes to the page you came from; opened straight from a link, it goes to `fallback`. */
function BackButton({ fallback }: { fallback: string }) {
  const t = useT();
  const navigate = useNavigate();
  const hasHistory = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return hasHistory ? (
    <button
      type="button"
      className="button button-icon"
      aria-label={t('common.back')}
      title={t('common.back')}
      onClick={() => void navigate(-1)}
    >
      <ArrowLeft size={16} aria-hidden="true" />
    </button>
  ) : (
    <Link
      className="button button-icon"
      to={fallback}
      aria-label={t('common.back')}
      title={t('common.back')}
    >
      <ArrowLeft size={16} aria-hidden="true" />
    </Link>
  );
}

/**
 * One company on one card that fills the window: who it is on the left, tabs on the right.
 * Each column scrolls inside itself; when the window is narrow they stack and the card scrolls.
 */
export function LeadView({
  lead,
  detail,
  backTo,
}: {
  lead: Lead;
  detail: Resource<CompanyCardDetail> & { data: CompanyCardDetail };
  backTo: string;
}) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const { card, notes, history, sectorName } = detail.data;
  const { company } = lead;

  return (
    <>
      <Card
        level={1}
        title={company.name}
        className="lead-detail"
        leading={
          <>
            <BackButton fallback={backTo} />
            <CompanyThumb card={card} size={44} />
          </>
        }
        actions={
          <>
            {sectorName && <span className="badge badge-sector">{sectorName}</span>}
            <span
              className="badge badge-score"
              aria-label={t('lead.score.total', { total: lead.score.total })}
            >
              {lead.score.total}
            </span>
          </>
        }
      >
        <div className="lead-columns">
          <div className="lead-col lead-col-left">
            <IdentityColumn lead={lead} detail={detail.data} />
            <LocationCard company={company} />
          </div>
          <div className="lead-col lead-col-right">
            <Tabs
              label={t('leadView.tabs')}
              tabs={TABS.map((id) => ({ id, label: t(`leadView.tab.${id}`) }))}
              value={tab}
              onChange={setTab}
            >
              {tab === 'overview' && (
                <OverviewTab
                  lead={lead}
                  detail={detail}
                  onAddDecisionMaker={() => setAdding(true)}
                />
              )}
              {tab === 'score' && <ScoreTab lead={lead} />}
              {tab === 'evidence' && <EvidenceTab lead={lead} />}
              {tab === 'notes' && (
                <NotesTab
                  companyId={company.id}
                  saved={notes}
                  draft={draft ?? notes}
                  onDraft={setDraft}
                  onSaved={(text) => {
                    detail.setData((d) => (d ? { ...d, notes: text } : d));
                    setDraft(null);
                  }}
                  history={history}
                  contacts={detail.data.contacts ?? []}
                />
              )}
            </Tabs>
          </div>
        </div>
      </Card>
      {adding && (
        <AddDecisionMakerModal
          card={card}
          onCancel={() => setAdding(false)}
          onSaved={(result) => {
            setAdding(false);
            detail.setData((d) => (d ? { ...d, card: result.company, person: result.person } : d));
            detail.reload();
            toast.show(
              t('crm.toast.saved', {
                person: result.person.person?.fullName ?? '',
                company: result.company.company.name,
              }),
            );
          }}
        />
      )}
    </>
  );
}
