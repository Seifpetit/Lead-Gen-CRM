import type { CrmCard } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useRef } from 'react';
import { EmptyState } from '../../../components/shared/EmptyState.js';
import { useT } from '../../../i18n/index.js';
import { LeadTile, type TileParts } from './LeadTile.js';

/** How close to the end the list must be scrolled before the next page is asked for. */
const AHEAD_PX = 240;

/**
 * The tiles in a grid that fits the width of the area it is in (see the `.tile-grid` rules), and
 * scrolls inside itself. The next page is requested near the end, or at once when what is loaded
 * does not fill the area.
 */
export function LeadGrid({
  cards,
  parts,
  hasMore,
  loadingMore,
  onLoadMore,
  selected,
  onToggle,
  empty,
  label,
}: {
  cards: readonly CrmCard[];
  parts: TileParts;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** With `onToggle`, each tile gets a checkbox. */
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  empty: string;
  label: string;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);

  const check = useCallback(() => {
    const el = box.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < AHEAD_PX) onLoadMore();
  }, [hasMore, loadingMore, onLoadMore]);
  useEffect(check, [check, cards.length]);

  return (
    <div ref={box} className="tile-scroll" onScroll={check}>
      {cards.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="tile-grid" aria-label={label}>
          {cards.map((card) => (
            <LeadTile
              key={card.id}
              card={card}
              parts={parts}
              {...(selected && onToggle
                ? { selected: selected.has(card.id), onToggle: () => onToggle(card.id) }
                : {})}
            />
          ))}
        </ul>
      )}
      {loadingMore && (
        <p className="muted small tile-more" role="status">
          {t('common.loading')}
        </p>
      )}
    </div>
  );
}
