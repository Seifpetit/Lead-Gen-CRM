import { regionLabel } from '@lead-gen-crm/shared';
import type { RunSummary } from '@lead-gen-crm/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ProgressTrack } from '../../../components/shared/ProgressTrack.js';
import { useT } from '../../../i18n/index.js';
import { useThrottled } from '../../../lib/useThrottled.js';
import { OutcomeBadge, outcomeText } from '../runOutcomeView.js';
import { RunProblem } from './RunProblem.js';
import { describeRun, spendText } from './runView.js';
import './live.css';

/** Screen readers hear a run's sentence at most this often, however fast it changes. */
export const ANNOUNCE_MS = 4_000;

function StripRow({ run, onChanged }: { run: RunSummary; onChanged?: (() => void) | undefined }) {
  const t = useT();
  const view = describeRun(t, run);
  return (
    <li className="strip-item">
      <div className="strip-row">
        <OutcomeBadge run={run} />
        <Link
          className="strip-sentence"
          to={`/leadgen/runs/${run.id}`}
          title={regionLabel(run.region)}
        >
          {view.sentence}
        </Link>
        <span className="strip-bar">
          <ProgressTrack
            size="thin"
            tone="teal"
            value={view.progress.overall}
            label={t('live.progress', { region: regionLabel(run.region) })}
            valueText={view.progressText}
          />
        </span>
        <span className="strip-spend">{spendText(t, run)}</span>
      </div>
      <RunProblem run={run} onChanged={onChanged} />
    </li>
  );
}

const DISMISSED_KEY = 'leadgen.dismissedEndedRuns';
const KEEP_DISMISSED = 50;

function readDismissed(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A run that has just ended, said in a line, until the person dismisses it. */
function EndedRow({ run, onDismiss }: { run: RunSummary; onDismiss: () => void }) {
  const t = useT();
  const region = regionLabel(run.region);
  return (
    <li className="strip-item strip-ended">
      <div className="strip-row strip-row-ended">
        <OutcomeBadge run={run} />
        <Link className="strip-sentence" to={`/leadgen/runs/${run.id}`} title={region}>
          {run.status === 'failed' && run.error ? run.error : outcomeText(t, run)}
        </Link>
        <button
          type="button"
          className="icon-button"
          aria-label={t('live.ended.dismiss', { region })}
          title={t('live.ended.dismiss', { region })}
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * One slim row for each run in progress (two at most), under the Dashboard header: what it is
 * doing in a sentence, a thin progress bar, what it has spent, and a link to the run. A run
 * with a problem says so in plain words underneath, with a way to check again or stop it. Runs
 * that ended in the last half hour stay as one line each until dismissed, so a failure is not
 * missed. Nothing is drawn when there is nothing to say, so the leads below take the room.
 */
export function LiveStrip({
  runs,
  ended = [],
  mode = 'live',
  unreachable = false,
  onChanged,
}: {
  runs: readonly RunSummary[];
  ended?: readonly RunSummary[];
  /** polling means the live stream dropped and the strip is asking every few seconds. */
  mode?: 'connecting' | 'live' | 'polling';
  /** The last attempt to read the runs failed, so what is shown may be old. */
  unreachable?: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(readDismissed);
  const spoken = useThrottled(
    runs
      .map(
        (run) =>
          `${regionLabel(run.region)}: ${describeRun(t, run).sentence}${run.problem ? `. ${run.problem.message}` : ''}`,
      )
      .join(' '),
    ANNOUNCE_MS,
  );
  const active = new Set(runs.map((r) => r.id));
  const recent = ended.filter((r) => !active.has(r.id) && !dismissed.includes(r.id));

  function dismiss(id: string) {
    const next = [...dismissed, id].slice(-KEEP_DISMISSED);
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; the line still goes away for now.
    }
  }

  if (runs.length === 0 && recent.length === 0) return null;
  const note = unreachable
    ? t('live.trouble')
    : mode === 'polling' && runs.length > 0
      ? t('live.reconnecting')
      : null;
  return (
    <section className="live-strip" aria-label={t('live.strip')}>
      <ul>
        {runs.map((run) => (
          <StripRow key={run.id} run={run} onChanged={onChanged} />
        ))}
        {recent.map((run) => (
          <EndedRow key={run.id} run={run} onDismiss={() => dismiss(run.id)} />
        ))}
      </ul>
      {note !== null && (
        <p className="strip-note" role="status">
          {note}
        </p>
      )}
      <p className="visually-hidden" aria-live="polite">
        {spoken}
      </p>
    </section>
  );
}
