import type { BoardStageKey, CrmBoard, CrmCard, CrmPipeline } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';
import { useApi } from '../../api/context.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { useResource } from '../../lib/useResource.js';
import { daysLeft } from './boardTime.js';

export const BOARD_ERRORS: Partial<Record<string, StringKey>> = {
  decision_maker_required: 'crm.error.decision_maker_required',
  suppressed: 'crm.error.suppressed',
  in_noise: 'crm.error.in_noise',
  invalid_decision_maker: 'crm.error.invalid_decision_maker',
  opted_out_is_final: 'lead.error.opted_out_is_final',
};

export const cardName = (card: CrmCard) => card.person?.fullName ?? card.company.name;

/**
 * One board with optimistic changes: a move, removal or restore shows at once, the server's copy
 * replaces it when the call succeeds, and when the server refuses the card goes back to where it
 * was and a toast says why. `hold` shows a card in a column without asking the server, for the
 * moment a form is open and the move is not final until it is saved.
 */
export function useBoard(pipeline: CrmPipeline) {
  const api = useApi();
  const toast = useToast();
  const t = useT();
  const resource = useResource<CrmBoard>(() => api.crm.board(pipeline), { deps: [pipeline] });
  const { setData } = resource;
  const [held, setHeld] = useState<Readonly<Record<string, BoardStageKey>>>({});
  const stageName = useCallback((key: BoardStageKey) => t(`boardStage.${key}`), [t]);

  const replace = useCallback(
    (card: CrmCard) =>
      setData((b) => (b ? { ...b, cards: b.cards.map((c) => (c.id === card.id ? card : c)) } : b)),
    [setData],
  );

  const cards = useMemo(
    () => (resource.data?.cards ?? []).map((c) => (held[c.id] ? { ...c, stage: held[c.id]! } : c)),
    [resource.data, held],
  );

  const hold = useCallback(
    (card: CrmCard, stage: BoardStageKey) => setHeld((h) => ({ ...h, [card.id]: stage })),
    [],
  );
  const release = useCallback(
    (card: CrmCard) =>
      setHeld((h) => Object.fromEntries(Object.entries(h).filter(([id]) => id !== card.id))),
    [],
  );

  const fail = useCallback(
    (key: StringKey, card: CrmCard, err: unknown) =>
      toast.show(
        t(key, { name: cardName(card), reason: describeError(t, err, BOARD_ERRORS) }),
        'error',
      ),
    [t, toast],
  );

  const remove = useCallback(
    async (card: CrmCard) => {
      if (card.stage === 'noise') return;
      const now = new Date().toISOString();
      replace({
        ...card,
        stage: 'noise',
        stageEnteredAt: now,
        noiseAt: now,
        purgeAt: null,
        removedFrom: card.stage,
      });
      try {
        const saved = await api.crm.remove(card.id);
        replace(saved);
        const left = daysLeft(saved);
        toast.show(
          t('crm.toast.removed', {
            name: cardName(card),
            left: left === null ? '' : ` ${t(leftKey(left), { count: left })}.`,
          }),
        );
      } catch (err) {
        replace(card);
        fail('crm.toast.removeFailed', card, err);
      }
    },
    [api, fail, replace, t, toast],
  );

  /** Moves a card; into Noise is a removal and out of Noise a restore, as on the server. */
  const move = useCallback(
    async (card: CrmCard, to: BoardStageKey, reason?: string) => {
      if (card.stage === to) return;
      if (to === 'noise') return remove(card);
      const wasNoise = card.stage === 'noise';
      replace({
        ...card,
        stage: to,
        stageEnteredAt: new Date().toISOString(),
        noiseAt: null,
        purgeAt: null,
        removedFrom: null,
      });
      try {
        const saved = await api.crm.move(card.id, to, reason);
        replace(saved);
        toast.show(
          t(wasNoise ? 'crm.toast.restored' : 'crm.toast.moved', {
            name: cardName(card),
            stage: stageName(saved.stage),
          }),
        );
      } catch (err) {
        replace(card);
        fail(wasNoise ? 'crm.toast.restoreFailed' : 'crm.toast.moveFailed', card, err);
      }
    },
    [api, fail, remove, replace, stageName, t, toast],
  );

  const restore = useCallback(
    async (card: CrmCard) => {
      if (card.stage !== 'noise') return;
      const to = card.removedFrom ?? (pipeline === 'companies' ? 'found' : 'new');
      replace({
        ...card,
        stage: to,
        stageEnteredAt: new Date().toISOString(),
        noiseAt: null,
        purgeAt: null,
        removedFrom: null,
      });
      try {
        const saved = await api.crm.restore(card.id);
        replace(saved);
        toast.show(
          t('crm.toast.restored', { name: cardName(card), stage: stageName(saved.stage) }),
        );
      } catch (err) {
        replace(card);
        fail('crm.toast.restoreFailed', card, err);
      }
    },
    [api, fail, pipeline, replace, stageName, t, toast],
  );

  return {
    ...resource,
    stages: resource.data?.stages ?? [],
    cards,
    move,
    remove,
    restore,
    hold,
    release,
    replace,
  };
}

export type Board = ReturnType<typeof useBoard>;

export const leftKey = (days: number): StringKey =>
  days === 0 ? 'crm.card.left.zero' : days === 1 ? 'crm.card.left.one' : 'crm.card.left.many';
