import type { BoardStage, BoardStageKey, CrmCard } from '@lead-gen-crm/shared';
import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, Globe, Mail, Phone, Trash2, Undo2 } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Popover } from '../../components/shared/Popover.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { safeHref } from '../../lib/format.js';
import { avatarColor, initialsOf } from './avatar.js';
import { daysInStage, daysLeft } from './boardTime.js';
import { sectorLook } from './sectorLook.js';
import { cardName, leftKey } from './useBoard.js';

const ICON = 16;

/** The LinkedIn mark; the icon set has no brand logos. */
function LinkedinIcon() {
  return (
    <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

/** What a card offers: open it, drag it, move it from a menu, remove it, or restore it from Noise. */
export interface CardActions {
  /** Columns a card may be moved to (the menu is the keyboard alternative to dragging). */
  targets: (card: CrmCard) => BoardStage[];
  onMove: (card: CrmCard, to: BoardStageKey) => void;
  onRemove: (card: CrmCard) => void;
  onRestore: (card: CrmCard) => void;
  /** A click or Enter on the card itself. */
  onOpen: (card: CrmCard) => void;
  /** The readable name of a sector id. */
  sectorName: (sector: string | null) => string | null;
}

/**
 * The picture on a company card: the page's preview image or the Maps photo when there is an
 * address and it loads, otherwise the sector's icon on its color. Only the address is stored.
 */
export function CompanyThumb({ card }: { card: CrmCard }) {
  const { imageUrl, sector } = card.company;
  const [failed, setFailed] = useState<string | null>(null);
  const look = sectorLook(sector);
  if (imageUrl && failed !== imageUrl) {
    return (
      <span className="thumb thumb-image" data-source={card.company.imageSource ?? undefined}>
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(imageUrl)}
        />
      </span>
    );
  }
  return (
    <span
      className="thumb thumb-tile"
      style={{ background: look.color }}
      data-sector={sector ?? ''}
    >
      <look.Icon size={28} strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

/** A round avatar: the provider's photo when it gave one and it loads, otherwise initials. */
export function PersonAvatar({ card }: { card: CrmCard }) {
  const name = card.person?.fullName ?? card.company.name;
  const photo = card.person?.photoUrl ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  if (photo && failed !== photo) {
    return (
      <span className="avatar-round avatar-photo">
        <img
          src={photo}
          alt=""
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
        />
      </span>
    );
  }
  return (
    <span className="avatar-round" style={{ background: avatarColor(name) }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

function ChannelLink({
  href,
  label,
  children,
  external = false,
}: {
  href: string;
  label: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      draggable={false}
      aria-label={label}
      title={label}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
    >
      {children}
    </a>
  );
}

/** The card's text and tools; the same for the card in its column and for the one being carried. */
export function CardFace({ card, actions }: { card: CrmCard; actions: CardActions }) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
  const phone = person ? person.phone : company.phone;
  const email = person ? person.email : company.email;
  const linkedin = person?.linkedinUrl ? safeHref(person.linkedinUrl) : null;
  const site = !person && company.website ? safeHref(company.website) : null;
  const final = card.stage === 'opted_out';
  const inNoise = card.stage === 'noise';
  const inStage = daysInStage(card);
  const left = daysLeft(card);
  const targets = final ? [] : actions.targets(card);
  const stageText = t(
    (inStage === 0
      ? 'crm.card.days.zero'
      : inStage === 1
        ? 'crm.card.days.one'
        : 'crm.card.days.many') as StringKey,
    { count: inStage },
  );

  const sub = inNoise
    ? [
        card.removedFrom &&
          t('crm.card.removedFrom', { stage: t(`boardStage.${card.removedFrom}`) }),
        left !== null && t(leftKey(left), { count: left }),
      ]
    : final
      ? [t('crm.card.optedOut')]
      : person
        ? [person.title, company.name]
        : [actions.sectorName(company.sector), t('crm.card.days.short', { count: inStage })];

  return (
    <>
      {person ? <PersonAvatar card={card} /> : <CompanyThumb card={card} />}
      <div className="kanban-card-main">
        <div className="kanban-card-row">
          <h4 className="kanban-card-title" title={name}>
            {name}
          </h4>
          {card.score !== null && !inNoise && (
            <span className="badge" aria-label={t('crm.card.score', { total: card.score })}>
              {card.score}
            </span>
          )}
        </div>
        <p className="kanban-card-sub" title={`${sub.filter(Boolean).join(' · ')} · ${stageText}`}>
          {sub.filter(Boolean).join(' · ')}
        </p>
        <div className="kanban-card-tools">
          <span className="kanban-card-channels">
            {phone && (
              <ChannelLink
                href={`tel:${phone.replace(/\s+/g, '')}`}
                label={t('crm.card.phone', { value: phone })}
              >
                <Phone size={ICON} aria-hidden="true" />
              </ChannelLink>
            )}
            {email && (
              <ChannelLink href={`mailto:${email}`} label={t('crm.card.email', { value: email })}>
                <Mail size={ICON} aria-hidden="true" />
              </ChannelLink>
            )}
            {site && (
              <ChannelLink href={site} label={t('crm.card.website', { name })} external>
                <Globe size={ICON} aria-hidden="true" />
              </ChannelLink>
            )}
            {linkedin && (
              <ChannelLink href={linkedin} label={t('crm.card.linkedin', { name })} external>
                <LinkedinIcon />
              </ChannelLink>
            )}
          </span>
          {!final && (
            <span className="kanban-card-actions">
              {targets.length > 0 && (
                <Popover
                  label={t('crm.card.moveTo.label', { name })}
                  icon={<ArrowRightLeft size={ICON} aria-hidden="true" />}
                  align="right"
                  portal
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
              {inNoise ? (
                <button
                  type="button"
                  className="button button-icon"
                  aria-label={t('crm.card.restore.label', { name })}
                  title={t('crm.card.restore.label', { name })}
                  onClick={() => actions.onRestore(card)}
                >
                  <Undo2 size={ICON} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-icon"
                  aria-label={t('crm.card.remove.label', { name })}
                  title={t('crm.card.remove.label', { name })}
                  onClick={() => actions.onRemove(card)}
                >
                  <Trash2 size={ICON} aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/** A click that ends a drag must not also open the card. */
const CLICK_AFTER_DRAG_MS = 250;

/**
 * A card in a column. The whole card is the drag handle: the mouse starts a drag after 6px of
 * movement (so a plain click opens the card and its phone, email and website icons work), a
 * finger after a short press, and the keyboard with Space on the focused card.
 */
export function BoardCard({ card, actions }: { card: CrmCard; actions: CardActions }) {
  const t = useT();
  const name = cardName(card);
  const final = card.stage === 'opted_out';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: final,
  });
  const endedAt = useRef(0);
  const wasDragging = useRef(false);
  useEffect(() => {
    if (wasDragging.current && !isDragging) endedAt.current = Date.now();
    wasDragging.current = isDragging;
  }, [isDragging]);

  const open = (event: MouseEvent<HTMLElement>) => {
    // Menus drawn on the page are children of the card for React, but not for the DOM.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest('a, button, input, select')) return;
    if (Date.now() - endedAt.current < CLICK_AFTER_DRAG_MS) return;
    actions.onOpen(card);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      // Focus moves into the dialog; without this the same key press would then press its button.
      event.preventDefault();
      actions.onOpen(card);
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The card holds links and buttons, so it is a group, not a button.
      role="group"
      aria-label={name}
      aria-roledescription={final ? undefined : t('crm.card.draggable')}
      tabIndex={0}
      data-card-id={card.id}
      className={`kanban-card kanban-card-${card.pipeline}${isDragging ? ' is-dragging' : ''}${final ? ' is-final' : ''}`}
      onClick={open}
      onKeyDown={keyDown}
    >
      <CardFace card={card} actions={actions} />
    </div>
  );
}
