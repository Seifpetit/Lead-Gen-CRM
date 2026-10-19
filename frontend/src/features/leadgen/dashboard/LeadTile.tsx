import type { CrmCard } from '@lead-gen-crm/shared';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useT } from '../../../i18n/index.js';
import { CompanyThumb, PersonAvatar } from '../../crm/BoardCard.js';
import { ChannelRows, ScoreBadge, cardSubtitle, cardTooltip } from '../../crm/cardParts.js';
import { cardName } from '../../crm/useBoard.js';

/** Which badges a tile shows, and how big it is; the card density in the filters chooses. */
export interface TileParts {
  stage: boolean;
  score: boolean;
  contact: boolean;
  /** A smaller picture and tighter padding. */
  compact: boolean;
}
export const ALL_PARTS: TileParts = {
  stage: true,
  score: true,
  contact: true,
  compact: false,
};
export const COMPACT_PARTS: TileParts = {
  stage: true,
  score: true,
  contact: false,
  compact: true,
};

/** What a tile needs to be dragged to another place in the grid, or moved with Alt and an arrow. */
export interface TileDrag {
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
}

/** Where a tile opens: the company page of its best lead; null when it has none. */
export function cardPath(card: CrmCard): string | null {
  return card.runId && card.leadId ? `/leadgen/runs/${card.runId}/leads/${card.leadId}` : null;
}

/**
 * One lead as a small card: picture, name on one line, the city and category, badges for its
 * stage and score, and how to reach it (the phone in full, the email and website as domains,
 * dimmed when there is none). Clicking anywhere on it opens the company page.
 */
export function LeadTile({
  card,
  parts,
  selected,
  onToggle,
  drag,
}: {
  card: CrmCard;
  parts: TileParts;
  /** Set to let the tile be rearranged. */
  drag?: TileDrag;
  /** Set (with `onToggle`) when the tile can be ticked for a bulk action. */
  selected?: boolean;
  onToggle?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const name = cardName(card);
  const { company, person } = card;
  const path = cardPath(card);

  const open = (event: MouseEvent) => {
    if (!path || (event.target as HTMLElement).closest('a, button, input, label')) return;
    void navigate(path);
  };
  const title = person
    ? [person.title, company.name].filter(Boolean).join(' · ')
    : `${name} · ${cardTooltip(card, t, null)}`;

  return (
    <li
      className={`tile${parts.compact ? ' tile-compact' : ''}${selected ? ' is-selected' : ''}${path ? ' is-link' : ''}${drag?.dragging ? ' is-dragging' : ''}`}
      data-card-id={card.id}
      onClick={open}
      {...(drag
        ? {
            draggable: true,
            onDragStart: drag.onDragStart,
            onDragOver: drag.onDragOver,
            onDragEnd: drag.onDragEnd,
            onKeyDown: drag.onKeyDown,
          }
        : {})}
    >
      {onToggle && (
        <input
          type="checkbox"
          className="tile-check"
          aria-label={t('leads.select', { name })}
          checked={selected === true}
          onChange={onToggle}
        />
      )}
      {person ? (
        <PersonAvatar card={card} />
      ) : (
        <CompanyThumb card={card} size={parts.compact ? 36 : 48} />
      )}
      <div className="tile-main">
        {path ? (
          <Link to={path} className="tile-name" title={title} draggable={false}>
            {name}
          </Link>
        ) : (
          <span className="tile-name" title={title}>
            {name}
          </span>
        )}
        <span className="tile-sub muted" title={title}>
          {person ? company.name : cardSubtitle(card)}
        </span>
        <div className="tile-badges">
          {parts.stage && <span className="badge">{t(`boardStage.${card.stage}`)}</span>}
          {parts.score && card.score !== null && <ScoreBadge score={card.score} />}
        </div>
        {parts.contact && <ChannelRows card={card} />}
      </div>
    </li>
  );
}
