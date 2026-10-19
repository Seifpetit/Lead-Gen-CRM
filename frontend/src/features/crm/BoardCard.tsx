import type { BoardStage, BoardStageKey, CrmCard } from '@lead-gen-crm/shared';
import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, GripVertical, Mail, Phone, Trash2, Undo2 } from 'lucide-react';
import { Popover } from '../../components/shared/Popover.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { safeHref } from '../../lib/format.js';
import { daysInStage, daysLeft } from './boardTime.js';
import { cardName, leftKey } from './useBoard.js';

const ICON = 14;

/** The LinkedIn mark; the icon set has no brand logos. */
function LinkedinIcon() {
  return (
    <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** What a card offers: drag it, move it from a menu, remove it, or restore it from Noise. */
export interface CardActions {
  /** Columns a card may be moved to (the menu is the keyboard alternative to dragging). */
  targets: (card: CrmCard) => BoardStage[];
  onMove: (card: CrmCard, to: BoardStageKey) => void;
  onRemove: (card: CrmCard) => void;
  onRestore: (card: CrmCard) => void;
}

export function CardBody({ card, now = new Date() }: { card: CrmCard; now?: Date }) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
  const phone = person ? person.phone : company.phone;
  const email = person ? person.email : company.email;
  const linkedin = person?.linkedinUrl ? safeHref(person.linkedinUrl) : null;
  const site = !person && company.website ? safeHref(company.website) : null;
  const inStage = daysInStage(card, now);
  const left = daysLeft(card, now);
  return (
    <>
      {person ? (
        <p className="kanban-card-sub">
          {[person.title, company.name].filter(Boolean).join(' · ')}
        </p>
      ) : (
        <p className="kanban-card-sub">
          {company.sector && <span>{company.sector}</span>}
          {company.sector && site && ' · '}
          {site && (
            <a
              href={site}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('crm.card.website', { name })}
            >
              {hostOf(company.website ?? '')}
            </a>
          )}
        </p>
      )}
      <p className="kanban-card-channels">
        {phone && (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            aria-label={t('crm.card.phone', { value: phone })}
            title={phone}
          >
            <Phone size={ICON} aria-hidden="true" />
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            aria-label={t('crm.card.email', { value: email })}
            title={email}
          >
            <Mail size={ICON} aria-hidden="true" />
          </a>
        )}
        {linkedin && (
          <a
            href={linkedin}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('crm.card.linkedin', { name })}
            title={t('crm.card.linkedin', { name })}
          >
            <LinkedinIcon />
          </a>
        )}
      </p>
      <p className="kanban-card-meta">
        {card.stage === 'noise' ? (
          <>
            {card.removedFrom && (
              <span>
                {t('crm.card.removedFrom', { stage: t(`boardStage.${card.removedFrom}`) })}
              </span>
            )}
            {left !== null && <strong>{t(leftKey(left), { count: left })}</strong>}
          </>
        ) : card.stage === 'opted_out' ? (
          <span>{t('crm.card.optedOut')}</span>
        ) : (
          <span>
            {t(
              (inStage === 0
                ? 'crm.card.days.zero'
                : inStage === 1
                  ? 'crm.card.days.one'
                  : 'crm.card.days.many') as StringKey,
              { count: inStage },
            )}
          </span>
        )}
      </p>
    </>
  );
}

export function BoardCard({ card, actions }: { card: CrmCard; actions: CardActions }) {
  const t = useT();
  const name = cardName(card);
  const final = card.stage === 'opted_out';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: final,
  });
  const targets = final ? [] : actions.targets(card);
  return (
    <li
      ref={setNodeRef}
      className={`kanban-card${isDragging ? ' is-dragging' : ''}`}
      aria-label={name}
    >
      <div className="kanban-card-head">
        {!final && (
          <button
            type="button"
            className="drag-handle"
            aria-label={t('crm.card.drag', { name })}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <h4 className="kanban-card-title">{name}</h4>
        {card.score !== null && (
          <span className="badge">{t('crm.card.score', { total: card.score })}</span>
        )}
      </div>
      <CardBody card={card} />
      {!final && (
        <div className="kanban-card-actions">
          {targets.length > 0 && (
            <Popover
              label={t('crm.card.moveTo.label', { name })}
              icon={<ArrowRightLeft size={ICON} aria-hidden="true" />}
              align="left"
            >
              {(close) => (
                <ul className="menu" aria-label={t('crm.card.moveTo')}>
                  {targets.map((stage) => (
                    <li key={stage.key}>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          actions.onMove(card, stage.key);
                        }}
                      >
                        {t(`boardStage.${stage.key}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popover>
          )}
          {card.stage === 'noise' ? (
            <button
              type="button"
              className="button"
              aria-label={t('crm.card.restore.label', { name })}
              onClick={() => actions.onRestore(card)}
            >
              <Undo2 size={ICON} aria-hidden="true" /> {t('crm.card.restore')}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              aria-label={t('crm.card.remove.label', { name })}
              onClick={() => actions.onRemove(card)}
            >
              <Trash2 size={ICON} aria-hidden="true" /> {t('crm.card.remove')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
