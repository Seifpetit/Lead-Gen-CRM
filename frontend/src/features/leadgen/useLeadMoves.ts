import type { CrmStage, Lead } from '@lead-gen-crm/shared';
import { useCallback, useState } from 'react';
import { useApi } from '../../api/context.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';

/**
 * Moves leads between CRM stages with an optimistic screen: the new stage shows at once, the
 * server's copy replaces it when the call succeeds, and if the call fails the lead goes back to
 * where it was and a toast says so.
 */
export function useLeadMoves({ onSaved }: { onSaved: (lead: Lead) => void }) {
  const api = useApi();
  const toast = useToast();
  const t = useT();
  const [pending, setPending] = useState<Readonly<Record<string, CrmStage>>>({});

  const moveMany = useCallback(
    async (leads: readonly Lead[], to: CrmStage) => {
      const moving = leads.filter((l) => l.crmStage !== to);
      if (moving.length === 0) return;
      setPending((p) => ({ ...p, ...Object.fromEntries(moving.map((l) => [l.id, to])) }));
      const results = await Promise.allSettled(moving.map((l) => api.leads.move(l.id, to)));
      let failed = 0;
      let firstError: unknown = null;
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          onSaved(result.value);
        } else {
          failed += 1;
          firstError ??= result.reason;
        }
      });
      // Saved ones now carry the server's stage; failed ones simply stop being overridden.
      setPending((p) => {
        const rest = { ...p };
        for (const l of moving) delete rest[l.id];
        return rest;
      });
      const stage = t(`crmStage.${to}`);
      if (failed === 0) {
        toast.show(t('leads.toast.moved', { count: moving.length, stage }));
      } else {
        toast.show(
          t('leads.toast.moveFailed', {
            failed,
            total: moving.length,
            stage,
            reason: describeError(t, firstError),
          }),
          'error',
        );
        if (failed < moving.length) {
          toast.show(t('leads.toast.moved', { count: moving.length - failed, stage }));
        }
      }
    },
    [api, onSaved, t, toast],
  );

  /** The leads as the screen should show them, with unsaved moves applied. */
  const show = useCallback(
    (leads: readonly Lead[]): Lead[] =>
      leads.map((l) => (pending[l.id] ? { ...l, crmStage: pending[l.id]! } : l)),
    [pending],
  );

  return { moveMany, show, hasPending: Object.keys(pending).length > 0 };
}
