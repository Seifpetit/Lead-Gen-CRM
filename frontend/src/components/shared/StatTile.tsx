import type { ReactNode } from 'react';

/**
 * A label, a large number and an optional hint underneath. Renders a term and its description,
 * so put tiles inside a `<dl>`; it reads as "label: value" aloud.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat-tile">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {hint && <span className="muted small stat-hint">{hint}</span>}
      </dd>
    </div>
  );
}
