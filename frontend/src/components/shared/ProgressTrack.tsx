/**
 * A horizontal bar from Start to End, filled to `value` (0 to 1), with optional ticks at the
 * given positions (0 to 1) such as cost checkpoints. `valueText` is what screen readers hear.
 */
export function ProgressTrack({
  value,
  label,
  valueText,
  checkpoints = [],
  startLabel,
  endLabel,
  checkpointsLabel,
  tone = 'coral',
}: {
  value: number;
  /** Accessible name of the bar. */
  label: string;
  valueText?: string;
  /** Tick positions along the bar, each 0 to 1. */
  checkpoints?: readonly number[];
  startLabel?: string;
  endLabel?: string;
  /** Caption shown between the Start and End labels, e.g. "Cost checkpoints". */
  checkpointsLabel?: string;
  /** Fill colour. */
  tone?: 'coral' | 'purple' | 'teal';
}) {
  const share = Math.min(1, Math.max(0, value));
  const hasScale = startLabel !== undefined || endLabel !== undefined || checkpointsLabel;
  return (
    <div className="progress" data-tone={tone}>
      {hasScale && (
        <div className="progress-scale" aria-hidden="true">
          <span>{startLabel}</span>
          <span className="progress-checkpoints">{checkpointsLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        {...(valueText ? { 'aria-valuetext': valueText } : {})}
      >
        <div className="progress-fill" style={{ width: `${share * 100}%` }} />
        {checkpoints.map((c) => (
          <span key={c} className="progress-tick" style={{ left: `${c * 100}%` }} />
        ))}
      </div>
    </div>
  );
}
