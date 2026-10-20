import type { CrmCard } from '@lead-gen-crm/shared';
import type { ReactNode } from 'react';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';
import { formatDay, safeHref } from '../../lib/format.js';
import { CompanyThumb, PersonAvatar, type CardActions } from './BoardCard.js';
import { daysInStage } from './boardTime.js';
import { cardName } from './useBoard.js';
import { ExternalLink } from '../../components/shared/ExternalLink.js';

/** Everything a card knows, opened by clicking the card (or Enter on it). */
export function CardDetailsModal({
  card,
  actions,
  onClose,
}: {
  card: CrmCard;
  actions: CardActions;
  onClose: () => void;
}) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
  const site = company.website ? safeHref(company.website) : null;
  const linkedin = person?.linkedinUrl ? safeHref(person.linkedinUrl) : null;
  const rows: { label: string; value: ReactNode }[] = [];
  const add = (label: string, value: ReactNode | null | undefined | false) => {
    if (value) rows.push({ label, value });
  };
  add(t('crm.details.stage'), t(`boardStage.${card.stage}`));
  if (person) {
    add(t('crm.details.jobTitle'), person.title);
    add(t('crm.details.company'), company.name);
  }
  add(t('crm.details.sector'), actions.sectorName(company.sector));
  add(t('crm.details.score'), card.score !== null && String(card.score));
  add(t('crm.details.inStage'), t(inStageKey(daysInStage(card)), { count: daysInStage(card) }));
  add(t('crm.details.since'), formatDay(card.stageEnteredAt));
  const phone = person ? person.phone : company.phone;
  const email = person ? person.email : company.email;
  add(t('crm.details.phone'), phone && <a href={`tel:${phone.replace(/\s+/g, '')}`}>{phone}</a>);
  add(t('crm.details.email'), email && <a href={`mailto:${email}`}>{email}</a>);
  add(
    t('crm.details.website'),
    site && (
      <ExternalLink kind="website" name={company.name} href={site}>
        {company.website}
      </ExternalLink>
    ),
  );
  add(
    t('crm.details.linkedin'),
    linkedin && (
      <ExternalLink kind="linkedin" name={name} href={linkedin}>
        {person?.linkedinUrl}
      </ExternalLink>
    ),
  );

  return (
    <Modal title={name} onClose={onClose}>
      <div className="modal-body card-details">
        <div className="card-details-head">
          {person ? <PersonAvatar card={card} /> : <CompanyThumb card={card} />}
          {person && <p className="muted">{company.name}</p>}
        </div>
        <dl className="details-list">
          {rows.map((r) => (
            <div key={r.label} className="details-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

const inStageKey = (days: number) =>
  days === 0 ? 'crm.card.days.zero' : days === 1 ? 'crm.card.days.one' : 'crm.card.days.many';
