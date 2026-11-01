import type { DevEstimate, DevStep, DevStepInput } from '@lead-gen-crm/shared';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { Modal } from '../../components/Modal.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatUsd } from '../../lib/format.js';
import type { FormProblem } from './devConsoleView.js';
import { JsonBox } from './Outputs.js';

const ESTIMATE_DELAY_MS = 400;

/**
 * What every step shares: the exact request, the estimate (free), and the two buttons. Only the
 * Modal's confirm button spends money. A step's own form sits above it as `children`.
 */
export function StepRunner({
  step,
  request,
  busy,
  onRun,
  requestLabel,
  children,
}: {
  step: DevStep;
  /** The input to send, or what is wrong with the form. */
  request: { input: DevStepInput } | { problem: FormProblem };
  /** A call is running (this one or another): nothing new can start. */
  busy: boolean;
  /** Starts the call; the page follows it from here. */
  onRun: (input: DevStepInput) => Promise<void>;
  requestLabel: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const api = useApi();
  const [estimate, setEstimate] = useState<DevEstimate | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const input = 'input' in request ? request.input : null;
  const key = JSON.stringify(input);
  const latest = useRef(input);
  latest.current = input;

  // The exact request and the price follow the form once it is valid. Asking is free.
  useEffect(() => {
    if (latest.current === null) {
      setEstimate(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        try {
          const found = await api.devConsole.estimate(step, latest.current!, controller.signal);
          if (controller.signal.aborted) return;
          setEstimate(found);
          setError(null);
        } catch (err) {
          if (controller.signal.aborted) return;
          setEstimate(null);
          setError(err);
        }
      },
      refresh === 0 ? ESTIMATE_DELAY_MS : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [api, step, key, refresh]);

  async function confirm() {
    if (!input) return;
    setStarting(true);
    try {
      await onRun(input);
      setAsking(false);
      setError(null);
    } catch (err) {
      setAsking(false);
      setError(err);
    } finally {
      setStarting(false);
    }
  }

  const problem = 'problem' in request ? request.problem : null;
  const canRun = input !== null && estimate !== null && !busy;

  return (
    <div className="dc-runner">
      {children}

      <section className="dc-request" aria-label={requestLabel}>
        <h3 className="dc-h">{requestLabel}</h3>
        {input === null ? (
          <p className="muted small">
            {problem ? t(`devc.problem.${problem}` as StringKey) : t('devc.request.waiting')}
          </p>
        ) : estimate === null ? (
          <p className="muted small">{t('devc.request.loading')}</p>
        ) : (
          <JsonBox value={estimate.requests} label={requestLabel} />
        )}
      </section>

      {estimate && (
        <p className="dc-estimate" role="status">
          {t('devc.estimate.line', {
            usd: formatUsd(estimate.estimateUsd),
            cap: formatUsd(estimate.capUsd),
            count: estimate.searches,
          })}
          {estimate.notice ? ` ${estimate.notice}` : ''}
        </p>
      )}
      {error !== null && (
        <p className="form-error" role="alert">
          {describeError(t, error)}
        </p>
      )}

      <div className="dc-buttons">
        <button
          type="button"
          className="button"
          disabled={input === null}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {t('devc.estimate')}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!canRun}
          onClick={() => setAsking(true)}
        >
          {t('devc.run')}
        </button>
        {busy && <span className="muted small">{t('devc.busy')}</span>}
      </div>

      {asking && estimate && (
        <Modal title={t('devc.confirm.title')} onClose={() => setAsking(false)}>
          <p>
            {t('devc.confirm.body', {
              usd: formatUsd(estimate.estimateUsd),
              cap: formatUsd(estimate.capUsd),
            })}
          </p>
          {estimate.notice && <p className="notice">{estimate.notice}</p>}
          <ul className="dc-lines">
            {estimate.lines.map((l, i) => (
              <li key={`${l.label}-${i}`}>
                {l.label}: {formatUsd(l.usd)}
              </li>
            ))}
          </ul>
          <footer className="modal-footer">
            <button type="button" className="button" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={starting}
              data-autofocus
              onClick={() => void confirm()}
            >
              {starting ? t('devc.confirm.starting') : t('devc.confirm.go')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
