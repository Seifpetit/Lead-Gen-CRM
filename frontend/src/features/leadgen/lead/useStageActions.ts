import type { BoardStageKey, CompanyCardDetail, CrmCard } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { useApi } from '../../../api/context.js';
import { useToast } from '../../../components/shared/Toast.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { daysLeft } from '../../crm/boardTime.js';
import { BOARD_ERRORS, leftKey } from '../../crm/useBoard.js';
import type { Resource } from '../../../lib/useResource.js';

/**
 * Moves, removes and restores the company's card, the same calls and the same messages as the
 * Companies board. Moving into the last stage is not here: it needs a decision-maker first.
 */
export function useStageActions(detail: Resource<CompanyCardDetail>, card: CrmCard) {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const name = card.company.name;

  /** Runs one change; the card it returns replaces the one shown, and the history is read again. */
  const run = async (
    change: () => Promise<CrmCard>,
    done: (saved: CrmCard) => string,
    failed: 'crm.toast.moveFailed' | 'crm.toast.removeFailed' | 'crm.toast.restoreFailed',
  ) => {
    setBusy(true);
    try {
      const saved = await change();
      detail.setData((d) => (d ? { ...d, card: saved } : d));
      detail.reload();
      toast.show(done(saved));
    } catch (err) {
      toast.show(t(failed, { name, reason: describeError(t, err, BOARD_ERRORS) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    move: (to: BoardStageKey) =>
      run(
        () => api.crm.move(card.id, to),
        () => t('crm.toast.moved', { name, stage: t(`boardStage.${to}`) }),
        'crm.toast.moveFailed',
      ),
    remove: () =>
      run(
        () => api.crm.remove(card.id),
        (saved) => {
          const left = daysLeft(saved);
          return t('crm.toast.removed', {
            name,
            left: left === null ? '' : ` ${t(leftKey(left), { count: left })}.`,
          });
        },
        'crm.toast.removeFailed',
      ),
    restore: () =>
      run(
        () => api.crm.restore(card.id),
        (saved) => t('crm.toast.restored', { name, stage: t(`boardStage.${saved.stage}`) }),
        'crm.toast.restoreFailed',
      ),
  };
}
