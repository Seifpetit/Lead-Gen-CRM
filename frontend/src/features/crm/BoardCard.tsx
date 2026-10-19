import type { BoardStage, BoardStageKey, CrmCard } from '@lead-gen-crm/shared';
import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, Trash2, Undo2 } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Popover } from '../../components/shared/Popover.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { avatarColor, initialsOf } from './avatar.js';
import { daysInStage, daysLeft } from './boardTime.js';
import { ChannelRows, LinkedinIcon, ScoreBadge, cardSubtitle, cardTooltip } from './cardParts.js';
import { sectorLook } from './sectorLook.js';
import { thumbShape } from './thumbShape.js';
import { cardName, leftKey } from './useBoard.js';

const ICON = 16;

export { LinkedinIcon };

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
export function CompanyThumb({ card, size }: { card: CrmCard; size?: number }) {
  const t = useT();
  const { imageUrl, sector } = card.company;
  const [failed, setFailed] = useState<string | null>(null);
  const look = sectorLook(sector);
  // The board's 56px unless the page asks for another size.
  const box: CSSProperties | undefined = size ? { width: size, height: size } : undefined;
  if (imageUrl && failed !== imageUrl) {
    return (
      <span
        className="thumb thumb-image"
        style={box}
        data-source={card.company.imageSource ?? undefined}
      >
        <img
          src={imageUrl}
          alt={t('crm.thumb.alt', { name: card.company.name })}
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(imageUrl)}
        />
      </span>
    );
  }
  // The outline is picked by the company id, so it is the same on every visit. It only decorates:
  // the name next to it is what identifies the company.
  return (
    <span
      className="thumb thumb-tile"
      style={box}
      data-sector={sector ?? ''}
      data-shape={thumbShape(card.company.id)}
      aria-hidden="true"
    >
      <span className="thumb-fill" style={{ background: look.color }}>
        <look.Icon size={size ? Math.round(size / 2) : 28} strokeWidth={2.25} />
      </span>
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

/** The card's text and tools; the same for the card in its column and for the one being carried. */
export function CardFace({ card, actions }: { card: CrmCard; actions: CardActions }) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
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
        : [cardSubtitle(card)];
  const subText = sub.filter(Boolean).join(' · ');
  const tooltip =
    person || inNoise || final
      ? `${subText} · ${stageText}`
      : `${cardTooltip(card, t, actions.sectorName(company.sector))} · ${stageText}`;

  const tools = final ? null : (
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
  );

  return (
    <>
      {person ? <PersonAvatar card={card} /> : <CompanyThumb card={card} />}
      <div className="kanban-card-main">
        <div className="kanban-card-row">
          <h4 className="kanban-card-title" title={name}>
            {name}
          </h4>
          {card.score !== null && !inNoise && <ScoreBadge score={card.score} />}
        </div>
        <p className="kanban-card-sub" title={tooltip}>
          {subText}
        </p>
        <ChannelRows card={card} trailing={tools} />
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
