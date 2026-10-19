import type { CrmCard } from '@lead-gen-crm/shared';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { EmptyState } from '../../../components/shared/EmptyState.js';
import { useT } from '../../../i18n/index.js';
import { cardName } from '../../crm/useBoard.js';
import { LeadTile, type TileDrag, type TileParts } from './LeadTile.js';
import { useTileOrder } from './useTileOrder.js';

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
  resetKey,
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
  /** A new value puts the cards back in the server's order (another sort or pipeline). */
  resetKey: string;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const hint = useId();
  const { ordered, move } = useTileOrder(cards, resetKey);
  const [dragId, setDragId] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  const check = useCallback(() => {
    const el = box.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < AHEAD_PX) onLoadMore();
  }, [hasMore, loadingMore, onLoadMore]);
  useEffect(check, [check, cards.length]);

  /** Where the dragged card goes when it is over `target`: before it or after it, by the half. */
  const dragOver = (target: string) => (event: DragEvent<HTMLLIElement>) => {
    if (dragId === null || dragId === target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    const rest = ordered.filter((c) => c.id !== dragId);
    const at = rest.findIndex((c) => c.id === target);
    move(dragId, after ? (rest[at + 1]?.id ?? null) : target);
  };

  /** Alt and an arrow key moves the card one place, for people who cannot drag. */
  const keyMove = (card: CrmCard) => (event: KeyboardEvent<HTMLLIElement>) => {
    const step =
      { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key as 'ArrowLeft'] ?? 0;
    if (!event.altKey || step === 0) return;
    event.preventDefault();
    const rest = ordered.filter((c) => c.id !== card.id);
    const from = ordered.findIndex((c) => c.id === card.id);
    const to = Math.min(rest.length, Math.max(0, from + step));
    const place = move(card.id, rest[to]?.id ?? null);
    setSaid(t('leads.reorder.moved', { name: cardName(card), place, total: ordered.length }));
    // Moving the element can drop the focus; put it back on the same card.
    requestAnimationFrame(() =>
      box.current
        ?.querySelector<HTMLElement>(
          `[data-card-id="${card.id}"] a, [data-card-id="${card.id}"] input`,
        )
        ?.focus(),
    );
  };

  const dragFor = (card: CrmCard): TileDrag => ({
    dragging: dragId === card.id,
    onDragStart: (event) => {
      event.dataTransfer.setData('text/plain', card.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragId(card.id);
    },
    onDragOver: dragOver(card.id),
    onDragEnd: () => setDragId(null),
    onKeyDown: keyMove(card),
  });

  return (
    <div ref={box} className="tile-scroll" onScroll={check}>
      {cards.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="tile-grid" aria-label={label} aria-describedby={hint}>
          {ordered.map((card) => (
            <LeadTile
              key={card.id}
              card={card}
              parts={parts}
              drag={dragFor(card)}
              {...(selected && onToggle
                ? { selected: selected.has(card.id), onToggle: () => onToggle(card.id) }
                : {})}
            />
          ))}
        </ul>
      )}
      <p id={hint} className="visually-hidden">
        {t('leads.reorder.hint')}
      </p>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      {loadingMore && (
        <p className="muted small tile-more" role="status">
          {t('common.loading')}
        </p>
      )}
    </div>
  );
}
