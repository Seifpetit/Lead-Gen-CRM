import type { BoardStage, BoardStageKey, CrmCard, CrmPipeline } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/shared/Toast.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { AddDecisionMakerModal } from './AddDecisionMakerModal.js';
import type { CardActions } from './BoardCard.js';
import { KanbanBoard } from './KanbanBoard.js';
import { OptOutDialog } from './OptOutDialog.js';
import { cardName, useBoard } from './useBoard.js';

/**
 * One CRM board (Companies or People). A move that needs more than a drop asks first: Decision-
 * maker identified opens the form that names the decision-maker, Opted out asks for the reason.
 */
export function BoardPage({ pipeline }: { pipeline: CrmPipeline }) {
  const t = useT();
  const toast = useToast();
  const board = useBoard(pipeline);
  const { move, remove, restore, hold, release, replace } = board;
  const [naming, setNaming] = useState<CrmCard | null>(null);
  const [optingOut, setOptingOut] = useState<CrmCard | null>(null);

  const request = useCallback(
    (card: CrmCard, to: BoardStageKey) => {
      if (card.stage === to) return;
      if (pipeline === 'companies' && to === 'decision_maker_identified') {
        // Shown in the column while the form is open; cancelling puts it back.
        hold(card, to);
        setNaming(card);
      } else if (pipeline === 'people' && to === 'opted_out') {
        setOptingOut(card);
      } else {
        void move(card, to);
      }
    },
    [hold, move, pipeline],
  );

  const targets = useCallback(
    (card: CrmCard): BoardStage[] =>
      board.stages.filter((s) => {
        if (s.key === card.stage || s.key === 'noise') return false;
        if (card.stage === 'noise') {
          return s.key !== 'decision_maker_identified' && s.key !== 'opted_out';
        }
        return true;
      }),
    [board.stages],
  );
  const actions: CardActions = useMemo(
    () => ({
      targets,
      onMove: request,
      onRemove: (c) => void remove(c),
      onRestore: (c) => void restore(c),
    }),
    [targets, request, remove, restore],
  );

  const label = t(pipeline === 'companies' ? 'crm.board.companies' : 'crm.board.people');
  return (
    <>
      <p className="muted">
        {t(pipeline === 'companies' ? 'crm.companies.intro' : 'crm.people.intro')}
      </p>
      {board.loading && board.data === null ? (
        <LoadingState />
      ) : board.data === null ? (
        <ErrorState error={board.error} onRetry={board.reload} />
      ) : (
        <>
          {board.cards.length === 0 &&
            (pipeline === 'companies' ? (
              <EmptyState title={t('crm.companies.empty.title')}>
                {t('crm.companies.empty.body')} <Link to="/leadgen">{t('crm.empty.link')}</Link>
              </EmptyState>
            ) : (
              <EmptyState title={t('crm.people.empty.title')}>
                {t('crm.people.empty.body')}{' '}
                <Link to="/crm/companies">{t('crm.people.empty.link')}</Link>
              </EmptyState>
            ))}
          <KanbanBoard
            label={label}
            stages={board.stages}
            cards={board.cards}
            actions={actions}
            onDrop={request}
          />
        </>
      )}
      {naming && (
        <AddDecisionMakerModal
          card={naming}
          onCancel={() => {
            release(naming);
            setNaming(null);
          }}
          onSaved={(result) => {
            release(naming);
            replace(result.company);
            setNaming(null);
            toast.show(
              t('crm.toast.saved', {
                person: result.person.person?.fullName ?? '',
                company: result.company.company.name,
              }),
            );
          }}
        />
      )}
      {optingOut && (
        <OptOutDialog
          busy={false}
          error={null}
          onCancel={() => setOptingOut(null)}
          onConfirm={(reason) => {
            const card = optingOut;
            setOptingOut(null);
            void move(card, 'opted_out', reason);
          }}
        />
      )}
    </>
  );
}

export { cardName };
