import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { niceTicks } from './chartScale.js';

export interface LinePoint {
  /** Shown under the axis and in the tooltip, e.g. "12 Oct". */
  label: string;
  value: number;
}

const W = 640;
const H = 240;
const M = { left: 40, right: 12, top: 12, bottom: 28 };

/**
 * A line over time with grid lines, axis numbers, and a crosshair whose bubble gives the exact
 * number. Drawn in the accent colour (one series); the same numbers are in a table for screen
 * readers, and the arrow keys walk the points.
 */
export function LineChart({
  title,
  summary,
  points,
  valueText,
  columns,
  showTitle = true,
}: {
  title: string;
  /** One line saying what the chart shows. */
  summary: string;
  points: readonly LinePoint[];
  /** The exact value as text, e.g. "3 leads". */
  valueText: (value: number) => string;
  /** Headings of the table that mirrors the chart. */
  columns: { x: string; y: string };
  /** Hide the visible title when a card around the chart already shows it. */
  showTitle?: boolean;
}) {
  const titleId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) =>
    M.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  function onPointerMove(event: PointerEvent) {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0 || points.length === 0) return;
    const vx = ((event.clientX - box.left) / box.width) * W;
    const ratio = (vx - M.left) / innerW;
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  }
  function onKeyDown(event: KeyboardEvent) {
    if (points.length === 0) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive((a) =>
      Math.min(points.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : points.length)) + step)),
    );
  }

  const current = active === null ? null : points[active];
  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption>
        <strong id={titleId} className={showTitle ? undefined : 'visually-hidden'}>
          {title}
        </strong>
        <span className="muted small">{summary}</span>
      </figcaption>
      <div
        className="chart-frame"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}. ${summary}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} />
              <text
                className="chart-axis"
                x={M.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={i} className="chart-axis" x={x(i)} y={H - 8} textAnchor="middle">
                {p.label}
              </text>
            ) : null,
          )}
          {points.length > 0 && <path className="chart-line" d={path} />}
          {active !== null && current && (
            <g>
              <line
                className="chart-cross"
                x1={x(active)}
                x2={x(active)}
                y1={M.top}
                y2={M.top + innerH}
              />
              <circle className="chart-dot" cx={x(active)} cy={y(current.value)} r={4} />
            </g>
          )}
        </svg>
        {active !== null && current && (
          <div
            className="chart-tip"
            style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(current.value) / H) * 100}%` }}
          >
            <span className="muted">{current.label}</span>
            <strong>{valueText(current.value)}</strong>
          </div>
        )}
      </div>
      <table className="visually-hidden" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">{columns.x}</th>
            <th scope="col">{columns.y}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{valueText(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
