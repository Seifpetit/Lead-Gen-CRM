import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { BoardCard, type CardActions } from './BoardCard.js';
import {
  CARD_HEIGHT,
  FALLBACK_VIEW_HEIGHT,
  LOAD_AHEAD,
  SLOT,
  visibleWindow,
  type Window,
} from './boardLayout.js';
import type { ColumnData } from './useBoard.js';

/** What the board needs from a column to work out where a dragged card would land. */
export interface ColumnHandle {
  section: HTMLElement;
  /** Null while the column is collapsed. */
  scroller: HTMLElement | null;
  count: () => number;
}

/**
 * One column: a fixed header (name and the true total) over a list that scrolls on its own.
 * Only the cards in view are drawn, each in a slot of fixed height, so a thousand cards cost
 * no more than twenty. When the list is scrolled near its end the next page is requested.
 * While a card is carried over this column, the cards below the drop point slide down a slot.
 */
export function BoardColumn({
  stage,
  actions,
  dragging,
  activeId,
  gapAt,
  isTarget,
  settlingId,
  register,
  onLoadMore,
}: {
  stage: ColumnData;
  actions: CardActions;
  /** A card is being carried somewhere on the board. */
  dragging: boolean;
  /** The card being carried; it stays drawn (as a dashed placeholder) wherever it has scrolled to. */
  activeId: string | null;
  /** Where the gap is open in this column, while a card is carried over it. */
  gapAt: number | null;
  isTarget: boolean;
  /** The card that was just dropped here. */
  settlingId: string | null;
  register: (key: string, handle: ColumnHandle | null) => void;
  onLoadMore: (stageKey: string) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(stage.collapsedByDefault);
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const count = stage.cards.length;
  const countRef = useRef(count);
  countRef.current = count;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [win, setWin] = useState<Window>(() => visibleWindow(count, 0, FALLBACK_VIEW_HEIGHT));
  const name = t(`boardStage.${stage.key}`);

  useEffect(() => {
    if (section.current) {
      register(stage.key, {
        section: section.current,
        scroller: collapsed ? null : scroller.current,
        count: () => countRef.current,
      });
    }
    return () => register(stage.key, null);
  }, [register, stage.key, collapsed]);

  /** Works out what is in view, and asks for the next page when the end is near. */
  const measure = useCallback(
    (askForMore: boolean) => {
      const el = scroller.current;
      const top = el?.scrollTop ?? 0;
      const height = el?.clientHeight || FALLBACK_VIEW_HEIGHT;
      const next = visibleWindow(countRef.current, top, height);
      setWin((w) => (w.first === next.first && w.last === next.last ? w : next));
      const s = stageRef.current;
      if (
        askForMore &&
        s.nextCursor &&
        !s.loadingMore &&
        countRef.current * SLOT - (top + height) < LOAD_AHEAD
      ) {
        onLoadMore(s.key);
      }
    },
    [onLoadMore],
  );

  // A new page, or a card moved in or out: draw what is in view now, and fill a short column.
  useLayoutEffect(() => measure(true), [count, collapsed, measure]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed, measure]);

  const activeIndex = activeId ? stage.cards.findIndex((c) => c.id === activeId) : -1;
  const shown: number[] = [];
  for (let i = win.first; i <= Math.min(win.last, count - 1); i++) shown.push(i);
  if (activeIndex >= 0 && !shown.includes(activeIndex)) shown.push(activeIndex);
  const height = (count + (gapAt !== null ? 1 : 0)) * SLOT;

  return (
    <section
      ref={section}
      className={`kanban-column kanban-column-${stage.key}${collapsed ? ' is-collapsed' : ''}${isTarget ? ' is-over' : ''}`}
      aria-label={name}
      data-stage={stage.key}
    >
      <header className="kanban-column-head">
        <h3>
          {name}{' '}
          <span className="count" aria-label={t('crm.column.total', { count: stage.total })}>
            {stage.total}
          </span>
        </h3>
        {stage.collapsedByDefault && (
          <button
            type="button"
            className="kanban-toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed
              ? t('crm.column.show', { stage: name, count: stage.total })
              : t('crm.column.hide', { stage: name })}
          </button>
        )}
      </header>
      {collapsed ? (
        dragging && <p className="muted small kanban-hint">{t('crm.column.dropHint')}</p>
      ) : (
        <div ref={scroller} className="kanban-scroll" onScroll={() => measure(true)} tabIndex={-1}>
          {count === 0 && !stage.loadingMore && (
            <p className="muted kanban-empty">{t('crm.column.empty')}</p>
          )}
          <ul className="kanban-cards" style={{ height }} aria-label={name}>
            {shown.map((i) => {
              const card = stage.cards[i]!;
              return (
                <li
                  key={card.id}
                  className={`kanban-slot${card.id === settlingId ? ' is-settling' : ''}`}
                  style={{
                    top: i * SLOT,
                    height: CARD_HEIGHT,
                    transform: gapAt !== null && i >= gapAt ? `translateY(${SLOT}px)` : undefined,
                  }}
                  aria-posinset={i + 1}
                  aria-setsize={stage.total}
                >
                  <BoardCard card={card} actions={actions} />
                </li>
              );
            })}
          </ul>
          {stage.loadingMore && (
            <p className="muted small kanban-more" role="status">
              {t('crm.column.loadingMore')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
