import { useId, useState } from 'react';

export interface Bar {
  key: string;
  label: string;
  value: number;
}

/**
 * Horizontal bars, longest first, with the exact number at the end of each. Hovering (or
 * focusing) one bar shows its number in a bubble and dims the others. The same numbers are in a
 * table for screen readers.
 */
export function BarChart({
  title,
  summary,
  bars,
  valueText,
  emptyText,
  columns,
  showTitle = true,
}: {
  title: string;
  summary: string;
  bars: readonly Bar[];
  valueText: (value: number) => string;
  emptyText: string;
  columns: { x: string; y: string };
  /** Hide the visible title when a card around the chart already shows it. */
  showTitle?: boolean;
}) {
  const titleId = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(0, ...bars.map((b) => b.value));
  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption>
        <strong id={titleId} className={showTitle ? undefined : 'visually-hidden'}>
          {title}
        </strong>
        <span className="muted small">{summary}</span>
      </figcaption>
      {bars.length === 0 ? (
        <p className="muted small chart-empty">{emptyText}</p>
      ) : (
        <ul className="bars" onPointerLeave={() => setHovered(null)}>
          {bars.map((bar) => {
            const share = max > 0 ? (bar.value / max) * 100 : 0;
            return (
              <li
                key={bar.key}
                className={`bar-row${hovered !== null && hovered !== bar.key ? ' is-dimmed' : ''}`}
                tabIndex={0}
                onPointerEnter={() => setHovered(bar.key)}
                onFocus={() => setHovered(bar.key)}
                onBlur={() => setHovered(null)}
              >
                <span className="bar-label" title={bar.label}>
                  {bar.label}
                </span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ width: `${Math.max(share, bar.value > 0 ? 1.5 : 0)}%` }}
                  />
                  {hovered === bar.key && (
                    <span className="chart-tip chart-tip-bar" style={{ left: `${share}%` }}>
                      <span className="muted">{bar.label}</span>
                      <strong>{valueText(bar.value)}</strong>
                    </span>
                  )}
                </span>
                <span className="bar-value">{valueText(bar.value)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <table className="visually-hidden" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">{columns.x}</th>
            <th scope="col">{columns.y}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{valueText(b.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
