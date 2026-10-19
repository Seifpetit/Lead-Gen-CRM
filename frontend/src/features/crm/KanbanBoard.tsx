import type { BoardStage, BoardStageKey, CrmCard } from '@lead-gen-crm/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { BoardCard, CardBody, type CardActions } from './BoardCard.js';
import { cardName } from './useBoard.js';

/**
 * Columns of cards. Cards drag between columns with the mouse, a finger (press and hold) or the
 * keyboard (focus a card's grip, Space, arrows, Space); every card also has a "Move to" menu.
 * Dropping only reports where; the page decides what the move needs (a form, a reason).
 */
export function KanbanBoard({
  label,
  stages,
  cards,
  actions,
  onDrop,
}: {
  label: string;
  stages: BoardStage[];
  cards: CrmCard[];
  actions: CardActions;
  onDrop: (card: CrmCard, to: BoardStageKey) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<CrmCard | null>(null);

  const start = (event: DragStartEvent) =>
    setDragging(cards.find((c) => c.id === event.active.id) ?? null);
  const end = (event: DragEndEvent) => {
    setDragging(null);
    const card = cards.find((c) => c.id === event.active.id);
    const to = event.over?.id as BoardStageKey | undefined;
    if (card && to && to !== card.stage) onDrop(card, to);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
    >
      <div className="kanban" role="group" aria-label={label}>
        {stages.map((stage) => (
          <Column
            key={stage.key}
            stage={stage}
            cards={cards.filter((c) => c.stage === stage.key)}
            actions={actions}
            dragging={dragging !== null}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="kanban-card kanban-card-overlay">
            <h4 className="kanban-card-title">{cardName(dragging)}</h4>
            <CardBody card={dragging} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  cards,
  actions,
  dragging,
}: {
  stage: BoardStage;
  cards: CrmCard[];
  actions: CardActions;
  dragging: boolean;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(stage.collapsedByDefault);
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const name = t(`boardStage.${stage.key}`);
  const toggle = (
    <button
      type="button"
      className="kanban-toggle"
      aria-expanded={!collapsed}
      onClick={() => setCollapsed((c) => !c)}
    >
      {collapsed
        ? t('crm.column.show', { stage: name, count: cards.length })
        : t('crm.column.hide', { stage: name })}
    </button>
  );
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column kanban-column-${stage.key}${collapsed ? ' is-collapsed' : ''}${isOver ? ' is-over' : ''}`}
      aria-label={name}
    >
      <header className="kanban-column-head">
        <h3>
          {name} <span className="count">{cards.length}</span>
        </h3>
        {stage.collapsedByDefault && toggle}
      </header>
      {collapsed ? (
        dragging && <p className="muted small">{t('crm.column.dropHint')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('crm.column.empty')}</p>
      ) : (
        <ul className="kanban-cards">
          {cards.map((card) => (
            <BoardCard key={card.id} card={card} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
}
