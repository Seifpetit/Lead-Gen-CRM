import { CRM_STAGES, type CrmStage, type Lead } from '@lead-gen-crm/shared';
import { useId, useState } from 'react';
import { useApi } from '../../api/context.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { OptOutDialog } from './OptOutDialog.js';

export function StageBadge({ stage }: { stage: CrmStage }) {
  const t = useT();
  return <span className={`badge badge-stage-${stage}`}>{t(`crmStage.${stage}`)}</span>;
}

/**
 * Moves a lead between CRM stages through the API. Opted out records an objection, so it asks
 * for a reason and a confirmation first; once opted out, a lead stays out.
 */
export function LeadActions({
  lead,
  name,
  onMoved,
}: {
  lead: Lead;
  /** What to call the lead for screen readers (company or person). */
  name: string;
  onMoved: (lead: Lead, note: string | null) => void;
}) {
  const t = useT();
  const api = useApi();
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [optOut, setOptOut] = useState(false);
  const stage = lead.crmStage;

  async function move(to: CrmStage) {
    setBusy(true);
    setError(null);
    try {
      const moved = await api.leads.move(lead.id, to);
      onMoved(moved, t('lead.moved', { stage: t(`crmStage.${to}`) }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function objection(reason: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.leads.objection(lead.id, reason);
      setOptOut(false);
      onMoved(result.lead, t('optout.done', { count: result.suppressed.length }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'opted_out') return <StageBadge stage={stage} />;

  const failure =
    error === null
      ? null
      : describeError(t, error, { opted_out_is_final: 'lead.error.opted_out_is_final' });

  return (
    <div className="lead-actions">
      <StageBadge stage={stage} />
      <div className="lead-action-row">
        {stage === 'system_suggested' && (
          <>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void move('confirmed')}
            >
              {t('lead.confirm')}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void move('dismissed')}
            >
              {t('lead.dismiss')}
            </button>
          </>
        )}
        <label htmlFor={selectId} className="visually-hidden">
          {t('lead.moveTo.label', { name })}
        </label>
        <select
          id={selectId}
          value=""
          disabled={busy}
          onChange={(e) => {
            const to = e.target.value as CrmStage;
            if (!to) return;
            if (to === 'opted_out') setOptOut(true);
            else void move(to);
          }}
        >
          <option value="">{busy ? t('lead.moving') : t('lead.moveTo')}</option>
          {CRM_STAGES.filter((s) => s !== stage).map((s) => (
            <option key={s} value={s}>
              {t(`crmStage.${s}` as StringKey)}
            </option>
          ))}
        </select>
      </div>
      {failure && !optOut && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}
      {optOut && (
        <OptOutDialog
          busy={busy}
          error={failure}
          onCancel={() => {
            setOptOut(false);
            setError(null);
          }}
          onConfirm={(reason) => void objection(reason)}
        />
      )}
    </div>
  );
}
