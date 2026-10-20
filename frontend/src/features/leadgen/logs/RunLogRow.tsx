import type { ApifyLogRun } from '@lead-gen-crm/shared';
import { useNavigate } from 'react-router';
import { ProgressTrack } from '../../../components/shared/ProgressTrack.js';
import { useT } from '../../../i18n/index.js';
import { formatDuration, formatUsd } from '../../../lib/format.js';
import { OutcomeBadge, outcomeText } from '../runOutcomeView.js';
import { StepIcons } from './StepIcons.js';
import { runName, runSeconds, searchCount } from './runLogView.js';

/**
 * One run as one compact row: its name, what it came to, a sentence about it, what it spent
 * against its cap, how long it took, and the button that opens everything about it.
 */
export function RunLogRow({
  entry,
  now,
  onOpen,
  selecting = false,
  selected = false,
  onToggle,
}: {
  entry: ApifyLogRun;
  now: number;
  onOpen: () => void;
  /** Export mode: a checkbox shows on the left and a click on the row picks it. */
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const t = useT();
  const { run } = entry;
  const navigate = useNavigate();
  const name = runName(run);
  const cap = run.budgetCapUsd;
  const spent = t('money.spentOfCap', { spent: formatUsd(run.spentUsd), cap: formatUsd(cap) });
  const summary = outcomeText(t, run, searchCount(entry.steps));
  return (
    <li
      className="logs-row"
      data-selecting={selecting ? 'true' : undefined}
      data-selected={selecting && selected ? 'true' : undefined}
      onClick={selecting ? onToggle : undefined}
    >
      {selecting && (
        <input
          type="checkbox"
          className="logs-check"
          checked={selected}
          onChange={() => onToggle?.()}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('logs.export.pick', { name })}
        />
      )}
      <strong className="logs-name">{name}</strong>
      <span className="logs-outcome">
        <OutcomeBadge run={run} />
      </span>
      <StepIcons run={run} />
      <span className="logs-summary" title={summary}>
        {summary}
      </span>
      <span className="logs-spend">
        <span className="small">{spent}</span>
        <ProgressTrack
          size="thin"
          tone="purple"
          value={cap > 0 ? Math.min(1, run.spentUsd / cap) : 0}
          label={t('apify.timeline', { region: name })}
          valueText={spent}
        />
      </span>
      <span className="logs-time small muted">{formatDuration(runSeconds(run, now))}</span>
      <span className="logs-actions" aria-hidden={selecting ? true : undefined}>
        <button
          type="button"
          className="button"
          aria-label={t('logs.row.leads.for', { name })}
          onClick={() => navigate(`/leadgen?run=${encodeURIComponent(run.id)}`)}
        >
          {t('logs.row.leads')}
        </button>
        <button
          type="button"
          className="button logs-open"
          aria-label={t('logs.row.open.for', { name })}
          onClick={onOpen}
        >
          {t('logs.row.open')}
        </button>
      </span>
    </li>
  );
}
