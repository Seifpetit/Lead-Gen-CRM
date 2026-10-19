import type { CrmCard } from '@lead-gen-crm/shared';
import { Globe, Phone } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useT } from '../../../i18n/index.js';
import { safeHref } from '../../../lib/format.js';
import { CompanyThumb, PersonAvatar } from '../../crm/BoardCard.js';
import { daysSince } from '../../crm/boardTime.js';
import { cardName } from '../../crm/useBoard.js';

/** Which badges a tile shows; the display settings turn them on and off. */
export interface TileParts {
  stage: boolean;
  score: boolean;
  found: boolean;
  contact: boolean;
}
export const ALL_PARTS: TileParts = { stage: true, score: true, found: true, contact: true };

const ICON = 14;

/** Where a tile opens: the company page of its best lead; null when it has none. */
export function cardPath(card: CrmCard): string | null {
  return card.runId && card.leadId ? `/leadgen/runs/${card.runId}/leads/${card.leadId}` : null;
}

/**
 * One lead as a small card: picture, name on one line, then badges for its stage, score and how
 * long ago it was found, and a phone and a website icon that are dimmed when there is none.
 * Clicking anywhere on it opens the company page.
 */
export function LeadTile({
  card,
  parts,
  selected,
  onToggle,
}: {
  card: CrmCard;
  parts: TileParts;
  /** Set (with `onToggle`) when the tile can be ticked for a bulk action. */
  selected?: boolean;
  onToggle?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const name = cardName(card);
  const { company, person } = card;
  const phone = person ? person.phone : company.phone;
  const site = !person && company.website ? safeHref(company.website) : null;
  const path = cardPath(card);
  const age = daysSince(card.foundAt);

  const open = (event: MouseEvent) => {
    if (!path || (event.target as HTMLElement).closest('a, button, input, label')) return;
    void navigate(path);
  };
  const title = person ? [person.title, company.name].filter(Boolean).join(' · ') : name;

  return (
    <li
      className={`tile${selected ? ' is-selected' : ''}${path ? ' is-link' : ''}`}
      data-card-id={card.id}
      onClick={open}
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
      {person ? <PersonAvatar card={card} /> : <CompanyThumb card={card} size={48} />}
      <div className="tile-main">
        {path ? (
          <Link to={path} className="tile-name" title={title}>
            {name}
          </Link>
        ) : (
          <span className="tile-name" title={title}>
            {name}
          </span>
        )}
        {person && <span className="tile-sub muted">{company.name}</span>}
        <div className="tile-badges">
          {parts.stage && <span className="badge">{t(`boardStage.${card.stage}`)}</span>}
          {parts.score && card.score !== null && (
            <span
              className="badge badge-score"
              aria-label={t('crm.card.score', { total: card.score })}
            >
              {card.score}
            </span>
          )}
          {parts.found && (
            <span className="tile-found muted">
              {t(age === 0 ? 'leads.found.today' : 'leads.found.ago', { count: age })}
            </span>
          )}
          {parts.contact && (
            <span className="tile-icons">
              {phone ? (
                <a
                  href={`tel:${phone.replace(/\s+/g, '')}`}
                  aria-label={t('crm.card.phone', { value: phone })}
                  title={phone}
                >
                  <Phone size={ICON} aria-hidden="true" />
                </a>
              ) : (
                <span className="is-missing" role="img" aria-label={t('leads.noPhone')}>
                  <Phone size={ICON} aria-hidden="true" />
                </span>
              )}
              {site ? (
                <a
                  href={site}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t('crm.card.website', { name })}
                  title={company.website ?? undefined}
                >
                  <Globe size={ICON} aria-hidden="true" />
                </a>
              ) : (
                <span className="is-missing" role="img" aria-label={t('leads.noWebsite')}>
                  <Globe size={ICON} aria-hidden="true" />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
