import { regionLabel, type RunSummary } from '@lead-gen-crm/shared';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../../api/context.js';
import { useT } from '../../../i18n/index.js';
import { formatClock } from '../../../lib/format.js';
import { StopRunDialog } from './StopRunDialog.js';

/**
 * What is wrong with a run in progress, in the server's plain words, since when, and what can
 * be done: look again now, or stop it. A retry in progress ("Searching again after a hiccup")
 * has no buttons, since the run is already dealing with it.
 */
export function RunProblem({
  run,
  onChanged,
  showStop = true,
}: {
  run: RunSummary;
  /** Called after the run was checked again or stopped, so the page reads it again. */
  onChanged?: (() => void) | undefined;
  /** The run card already has a Stop button of its own. */
  showStop?: boolean;
}) {
  const t = useT();
  const api = useApi();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const problem = run.problem;
  if (!problem) return null;

  async function recheck() {
    setChecking(true);
    setFailed(false);
    try {
      await api.runs.recheck(run.id);
      onChanged?.();
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }

  const calm = problem.kind === 'retrying';
  return (
    <div
      className="run-problem"
      data-kind={problem.kind}
      role={calm ? 'status' : 'alert'}
      aria-label={t('live.problem.label', { region: regionLabel(run.region) })}
    >
      <TriangleAlert size={14} aria-hidden="true" />
      <span className="run-problem-text">
        {problem.message}
        {problem.kind !== 'retrying' && (
          <span className="muted">
            {' '}
            {t('live.problem.since', { time: formatClock(problem.since) })}
          </span>
        )}
      </span>
      {problem.action === 'recheck' && (
        <button type="button" className="button" disabled={checking} onClick={() => void recheck()}>
          {checking ? t('live.problem.rechecking') : t('live.problem.recheck')}
        </button>
      )}
      {showStop && problem.action !== null && (
        <button type="button" className="button button-danger" onClick={() => setStopping(true)}>
          {t('live.problem.stop')}
        </button>
      )}
      {failed && <span className="form-error">{t('live.problem.failed')}</span>}
      {stopping && (
        <StopRunDialog
          runId={run.id}
          onStopped={() => {
            setStopping(false);
            onChanged?.();
          }}
          onClose={() => setStopping(false)}
        />
      )}
    </div>
  );
}
