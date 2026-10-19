import type { BoardStageKey, CrmCard } from '@lead-gen-crm/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { CardFace, type CardActions } from './BoardCard.js';
import { BoardColumn, type ColumnHandle } from './BoardColumn.js';
import { SLOT, dropIndex } from './boardLayout.js';
import { cardName, type ColumnData } from './useBoard.js';

/** Near a column's top or bottom edge (px) it scrolls by itself while a card is held there. */
const EDGE = 64;
const MAX_STEP = 18;

interface Hover {
  stage: BoardStageKey;
  index: number;
}

interface Point {
  x: number;
  y: number;
}

/** Where the pointer is: the press point plus how far it has moved; for the keyboard, the card. */
function pointerOf(event: DragStartEvent | DragMoveEvent): Point {
  const origin = event.activatorEvent as Partial<MouseEvent & TouchEvent>;
  const delta = 'delta' in event ? event.delta : { x: 0, y: 0 };
  if (typeof origin.clientX === 'number' && typeof origin.clientY === 'number') {
    return { x: origin.clientX + delta.x, y: origin.clientY + delta.y };
  }
  const touch = origin.touches?.[0] ?? origin.changedTouches?.[0];
  if (touch) return { x: touch.clientX + delta.x, y: touch.clientY + delta.y };
  const rect = event.active.rect.current.translated;
  return rect ? { x: rect.left + rect.width / 2, y: rect.top } : { x: 0, y: 0 };
}

const step = (distance: number) => Math.ceil(2 + (MAX_STEP - 2) * Math.min(distance / EDGE, 1));

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Columns of cards that fill the height they are given; each column scrolls on its own. A card
 * is picked up anywhere on it: the mouse after 6px of movement (a click still opens it), a finger
 * after a short press (so a column still scrolls under it), the keyboard with Space on the focused
 * card and the arrow keys. It lifts, a dashed placeholder stays behind, the column under it opens
 * a gap, and columns scroll by themselves when it is held near their edge. Dropping only reports
 * where; the page decides what the move needs (a form, a reason). Escape puts the card back.
 */
export function KanbanBoard({
  label,
  stages,
  actions,
  onDrop,
  onLoadMore,
}: {
  label: string;
  stages: ColumnData[];
  actions: CardActions;
  onDrop: (card: CrmCard, to: BoardStageKey, index: number) => void;
  onLoadMore: (stageKey: string) => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const board = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<string, ColumnHandle>());
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const pointer = useRef<Point | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const crossed = useRef(false);

  const [dragging, setDragging] = useState<CrmCard | null>(null);
  const [hover, setHoverState] = useState<Hover | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A finger that presses and holds picks the card up; one that moves first is scrolling.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: ((event, { currentCoordinates, context }) => {
        const rect = context.collisionRect;
        if (!rect) return undefined;
        if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
          event.preventDefault();
          return {
            ...currentCoordinates,
            y: currentCoordinates.y + (event.code === 'ArrowDown' ? SLOT : -SLOT),
          };
        }
        if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined;
        event.preventDefault();
        const columns = [...handles.current.values()]
          .map((h) => ({ h, box: h.section.getBoundingClientRect() }))
          .sort((a, b) => a.box.left - b.box.left);
        const middle = rect.left + rect.width / 2;
        const at = columns.findIndex((c) => middle >= c.box.left && middle <= c.box.right);
        const next = columns[at + (event.code === 'ArrowRight' ? 1 : -1)];
        if (at < 0 || !next) return undefined;
        const list = (next.h.scroller ?? next.h.section).getBoundingClientRect();
        return { x: next.box.left + (next.box.width - rect.width) / 2, y: list.top };
      }) satisfies KeyboardCoordinateGetter,
    }),
  );

  const register = useCallback((key: string, handle: ColumnHandle | null) => {
    if (handle) handles.current.set(key, handle);
    else handles.current.delete(key);
  }, []);

  const setHover = useCallback((next: Hover | null) => {
    const prev = hoverRef.current;
    if (prev?.stage === next?.stage && prev?.index === next?.index) return;
    hoverRef.current = next;
    setHoverState(next);
  }, []);

  /** The column under a point and the slot in it that the point is nearest. */
  const measure = useCallback((point: Point): Hover | null => {
    for (const [key, handle] of handles.current) {
      const box = handle.section.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) {
        continue;
      }
      if (!handle.scroller) return { stage: key as BoardStageKey, index: 0 };
      const list = handle.scroller.getBoundingClientRect();
      return {
        stage: key as BoardStageKey,
        index: dropIndex(point.y, list.top, handle.scroller.scrollTop, handle.count()),
      };
    }
    return null;
  }, []);

  // While a card is held near an edge the column (or the board sideways) scrolls by itself, and
  // the gap follows the pointer as the cards move under it.
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const point = pointer.current;
      if (point) {
        const here = measure(point);
        const handle = here && handles.current.get(here.stage);
        if (handle?.scroller) {
          const box = handle.scroller.getBoundingClientRect();
          if (point.y < box.top + EDGE) handle.scroller.scrollTop -= step(box.top + EDGE - point.y);
          else if (point.y > box.bottom - EDGE) {
            handle.scroller.scrollTop += step(point.y - (box.bottom - EDGE));
          }
        }
        const outer = board.current?.getBoundingClientRect();
        if (board.current && outer) {
          if (point.x < outer.left + EDGE)
            board.current.scrollLeft -= step(outer.left + EDGE - point.x);
          else if (point.x > outer.right - EDGE) {
            board.current.scrollLeft += step(point.x - (outer.right - EDGE));
          }
        }
        setHover(measure(point));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, measure, setHover]);

  const find = (id: string | number) =>
    stagesRef.current.flatMap((s) => s.cards).find((c) => c.id === id) ?? null;

  const start = (event: DragStartEvent) => {
    const card = find(event.active.id);
    document.body.classList.add('is-dragging-card');
    pointer.current = pointerOf(event);
    crossed.current = false;
    hoverRef.current = null;
    setDragging(card);
    setHover(measure(pointer.current));
  };
  const move = (event: DragMoveEvent) => {
    pointer.current = pointerOf(event);
    setHover(measure(pointer.current));
  };
  const finish = () => {
    document.body.classList.remove('is-dragging-card');
    pointer.current = null;
    setDragging(null);
    setHover(null);
  };
  const end = (event: DragEndEvent) => {
    const card = find(event.active.id);
    const landing = pointer.current ? measure(pointer.current) : hoverRef.current;
    const keyboard = event.activatorEvent instanceof KeyboardEvent;
    crossed.current = !!card && !!landing && landing.stage !== card.stage;
    finish();
    if (card && landing && landing.stage !== card.stage) {
      setSettling(card.id);
      window.setTimeout(() => setSettling(null), 400);
      onDrop(card, landing.stage, landing.index);
      if (keyboard) {
        // The card is drawn again in its new column; the keyboard user stays on it.
        window.setTimeout(
          () =>
            (document.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement | null)?.focus(),
          50,
        );
      }
    }
  };

  const announcements: Announcements = useMemo(() => {
    const name = (id: string | number) => {
      const card = stagesRef.current.flatMap((s) => s.cards).find((c) => c.id === id);
      return card ? cardName(card) : '';
    };
    return {
      onDragStart: ({ active }) => t('crm.drag.picked', { name: name(active.id) }),
      onDragOver: () => undefined,
      onDragEnd: ({ active }) => {
        const to = hoverRef.current;
        return to
          ? t('crm.drag.dropped', { name: name(active.id), stage: t(`boardStage.${to.stage}`) })
          : t('crm.drag.cancelled', { name: name(active.id) });
      },
      onDragCancel: ({ active }) => t('crm.drag.cancelled', { name: name(active.id) }),
    };
  }, [t]);

  const source = dragging?.stage ?? null;
  const target = hover && hover.stage !== source ? hover : null;
  const targetStage = target ? stages.find((s) => s.key === target.stage) : undefined;
  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={start}
      onDragMove={move}
      onDragEnd={end}
      onDragCancel={finish}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('crm.drag.help') },
      }}
    >
      <div ref={board} className="kanban" role="group" aria-label={label}>
        {stages.map((stage) => (
          <BoardColumn
            key={stage.key}
            stage={stage}
            actions={actions}
            dragging={dragging !== null}
            activeId={dragging?.id ?? null}
            gapAt={target?.stage === stage.key ? target.index : null}
            isTarget={target?.stage === stage.key}
            settlingId={settling}
            register={register}
            onLoadMore={onLoadMore}
          />
        ))}
      </div>
      <p className="visually-hidden" role="status">
        {dragging && target && targetStage
          ? t('crm.drag.over', {
              name: cardName(dragging),
              stage: t(`boardStage.${targetStage.key}`),
              position: target.index + 1,
              total: targetStage.cards.length + 1,
            })
          : ''}
      </p>
      <DragOverlay
        dropAnimation={reduced || crossed.current ? null : { duration: 150, easing: 'ease-out' }}
      >
        {dragging && (
          <div
            className={`kanban-card kanban-card-${dragging.pipeline} kanban-card-overlay`}
            aria-hidden="true"
          >
            <CardFace card={dragging} actions={actions} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
