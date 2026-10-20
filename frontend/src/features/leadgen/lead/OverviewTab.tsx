import type { BoardStageKey, CompanyCardDetail, Lead } from '@lead-gen-crm/shared';
import { Info, Mail, Phone, Trash2, Undo2, UserPlus } from 'lucide-react';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';
import { safeHref } from '../../../lib/format.js';
import { avatarColor, initialsOf } from '../../crm/avatar.js';
import { LinkedinIcon } from '../../crm/BoardCard.js';
import { daysLeft } from '../../crm/boardTime.js';
import { leftKey } from '../../crm/useBoard.js';
import { useStageActions } from './useStageActions.js';
import type { Resource } from '../../../lib/useResource.js';
import { ExternalLink } from '../../../components/shared/ExternalLink.js';
import { WhatsAppButton } from '../../outreach/WhatsAppButton.js';

const ICON = 16;
const STAGES = ['found', 'investigating', 'decision_maker_identified'] as const;

interface Person {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}

/** The person the CRM holds for this company, else the one the run found. */
function personOf(lead: Lead, detail: CompanyCardDetail): Person | null {
  const named = detail.person?.person;
  if (named) {
    return {
      id: named.id,
      name: named.fullName,
      title: named.title,
      email: named.email,
      phone: named.phone,
      linkedinUrl: named.linkedinUrl,
    };
  }
  const c = lead.contact;
  return c
    ? {
        id: c.id,
        name: c.fullName,
        title: c.title,
        email: c.email,
        phone: c.phone,
        linkedinUrl: c.linkedinUrl,
      }
    : null;
}

function DecisionMaker({
  person,
  lead,
  onAdd,
}: {
  person: Person | null;
  lead: Lead;
  onAdd: () => void;
}) {
  const t = useT();
  const linkedin = person?.linkedinUrl ? safeHref(person.linkedinUrl) : null;
  return (
    <section className="dm-card" aria-label={t('leadView.dm.title')}>
      <h3>{t('leadView.dm.title')}</h3>
      {person ? (
        <div className="dm-person">
          <span
            className="avatar-round dm-avatar"
            style={{ background: avatarColor(person.name) }}
            aria-hidden="true"
          >
            {initialsOf(person.name)}
          </span>
          <div className="dm-text">
            <p className="dm-name">{person.name}</p>
            {person.title && <p className="muted">{person.title}</p>}
          </div>
          <div className="dm-channels">
            {person.phone && (
              <a
                className="button button-icon"
                href={`tel:${person.phone.replace(/[\s().-]/g, '')}`}
                aria-label={t('leadView.dm.phone', { name: person.name })}
                title={person.phone}
              >
                <Phone size={ICON} aria-hidden="true" />
              </a>
            )}
            {person.email && (
              <a
                className="button button-icon"
                href={`mailto:${person.email}`}
                aria-label={t('leadView.dm.email', { name: person.name })}
                title={person.email}
              >
                <Mail size={ICON} aria-hidden="true" />
              </a>
            )}
            <WhatsAppButton
              variant="button"
              target={{
                companyId: lead.company.id,
                personId: person.id,
                company: lead.company.name,
                sector: lead.company.sector,
                person: person.name,
                phone: person.phone,
              }}
            />
            {linkedin && (
              <ExternalLink
                kind="linkedin"
                name={person.name}
                className="button button-icon"
                href={linkedin}
                aria-label={t('leadView.dm.linkedin', { name: person.name })}
                title={t('lead.linkedin')}
              >
                <LinkedinIcon />
              </ExternalLink>
            )}
            {!person.phone && !person.email && !linkedin && (
              <span className="muted">{t('leadView.dm.noChannel')}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="dm-empty">
          <p className="dm-name">{t('leadView.dm.none')}</p>
          <p className="muted">{t('leadView.dm.noneHelp')}</p>
          <button type="button" className="button button-primary button-icon-text" onClick={onAdd}>
            <UserPlus size={ICON} aria-hidden="true" />
            {t('leadView.dm.add')}
          </button>
        </div>
      )}
    </section>
  );
}

/** The decision-maker first, then what can be done with the company: its stage, or remove it. */
export function OverviewTab({
  lead,
  detail,
  onAddDecisionMaker,
}: {
  lead: Lead;
  detail: Resource<CompanyCardDetail> & { data: CompanyCardDetail };
  onAddDecisionMaker: () => void;
}) {
  const t = useT();
  const { card } = detail.data;
  const actions = useStageActions(detail, card);
  const inNoise = card.stage === 'noise';
  const left = daysLeft(card);
  const choose = (to: BoardStageKey) => {
    if (to === card.stage) return;
    // The last stage is reached by naming the decision-maker, as on the board.
    if (to === 'decision_maker_identified') onAddDecisionMaker();
    else void actions.move(to);
  };
  return (
    <div className="lead-overview">
      <DecisionMaker person={personOf(lead, detail.data)} lead={lead} onAdd={onAddDecisionMaker} />
      <section className="action-bar" aria-label={t('leadView.actions')}>
        <ToggleGroup
          label={t('leadView.stage')}
          value={inNoise ? '' : (card.stage as (typeof STAGES)[number])}
          disabled={actions.busy || inNoise}
          options={STAGES.map((s) => ({ value: s, label: t(`boardStage.${s}`) }))}
          onChange={choose}
        />
        {inNoise ? (
          <>
            <p className="muted action-note" role="status">
              {t('leadView.inNoise', {
                left: left === null ? '' : ` ${t(leftKey(left), { count: left })}.`,
              })}
            </p>
            <button
              type="button"
              className="button button-icon-text"
              disabled={actions.busy}
              aria-label={t('leadView.restore.label', { name: card.company.name })}
              onClick={() => void actions.restore()}
            >
              <Undo2 size={ICON} aria-hidden="true" />
              {t('leadView.restore')}
            </button>
          </>
        ) : (
          <span className="action-remove">
            <button
              type="button"
              className="button button-danger button-icon-text"
              disabled={actions.busy}
              aria-label={t('leadView.remove.label', { name: card.company.name })}
              onClick={() => void actions.remove()}
            >
              <Trash2 size={ICON} aria-hidden="true" />
              {t('leadView.remove')}
            </button>
            <Tip label={t('leadView.info')} text={t('lead.dismissNote')}>
              <Info size={14} aria-hidden="true" />
            </Tip>
          </span>
        )}
      </section>
    </div>
  );
}
