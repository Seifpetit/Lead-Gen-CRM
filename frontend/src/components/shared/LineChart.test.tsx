import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineChart } from './LineChart.js';

const points = [
  { label: '16 Oct', value: 0 },
  { label: '17 Oct', value: 4 },
  { label: '18 Oct', value: 2 },
];
const chart = (over = {}) => (
  <LineChart
    title="Leads per day"
    summary="6 leads in 3 days."
    points={points}
    valueText={(n) => `Leads: ${n}`}
    columns={{ x: 'Day', y: 'Leads' }}
    {...over}
  />
);

describe('LineChart', () => {
  it('is titled, has a summary, axis numbers, and grid lines', () => {
    const { container } = render(chart());
    expect(screen.getByText('Leads per day')).toBeVisible();
    expect(screen.getByText('6 leads in 3 days.')).toBeVisible();
    expect(screen.getByRole('img', { name: /Leads per day/ })).toBeInTheDocument();
    const axis = [...container.querySelectorAll('.chart-axis')].map((n) => n.textContent);
    expect(axis).toEqual(expect.arrayContaining(['0', '2', '4', '16 Oct', '18 Oct']));
    expect(container.querySelectorAll('.chart-grid').length).toBeGreaterThan(1);
  });

  it('gives the exact number in a bubble on hover and with the arrow keys', () => {
    const { container } = render(chart());
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 640, top: 0, height: 240 }) as DOMRect;
    expect(container.querySelector('.chart-tip')).toBeNull();
    // The far right of the plot is the last day.
    fireEvent.pointerMove(svg, { clientX: 630 });
    expect(container.querySelector('.chart-tip')).toHaveTextContent('18 OctLeads: 2');
    fireEvent.pointerLeave(svg);
    expect(container.querySelector('.chart-tip')).toBeNull();

    const frame = container.querySelector('.chart-frame')!;
    fireEvent.keyDown(frame, { key: 'ArrowRight' });
    expect(container.querySelector('.chart-tip')).toHaveTextContent('16 OctLeads: 0');
    fireEvent.keyDown(frame, { key: 'ArrowRight' });
    expect(container.querySelector('.chart-tip')).toHaveTextContent('17 OctLeads: 4');
  });

  it('has the same numbers as a table for screen readers', () => {
    render(chart());
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['DayLeads', '16 OctLeads: 0', '17 OctLeads: 4', '18 OctLeads: 2']);
  });

  it('draws an empty chart without breaking', () => {
    const { container } = render(chart({ points: [] }));
    expect(container.querySelector('.chart-line')).toBeNull();
  });
});
