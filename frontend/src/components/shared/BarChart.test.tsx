import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarChart } from './BarChart.js';

const bars = [
  { key: 'a', label: 'Textile', value: 6 },
  { key: 'b', label: 'Food', value: 3 },
  { key: 'c', label: 'Wood', value: 1 },
];
const chart = (over = {}) => (
  <BarChart
    title="Leads by sector"
    summary="10 leads."
    bars={bars}
    valueText={(n) => `Leads: ${n}`}
    emptyText="No leads in this range."
    columns={{ x: 'Sector', y: 'Leads' }}
    {...over}
  />
);

describe('BarChart', () => {
  it('is titled and shows the number at the end of each bar', () => {
    const { container } = render(chart());
    expect(screen.getByText('Leads by sector')).toBeVisible();
    expect(screen.getByText('10 leads.')).toBeVisible();
    const rows = container.querySelectorAll('.bar-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector('.bar-value')).toHaveTextContent('Leads: 6');
    // The longest bar fills the track; the others are in proportion.
    expect((rows[0]!.querySelector('.bar-fill') as HTMLElement).style.width).toBe('100%');
    expect((rows[1]!.querySelector('.bar-fill') as HTMLElement).style.width).toBe('50%');
  });

  it('hovering one bar shows its number in a bubble and dims the others', () => {
    const { container } = render(chart());
    const rows = container.querySelectorAll('.bar-row');
    fireEvent.pointerEnter(rows[1]!);
    expect(rows[1]!.querySelector('.chart-tip')).toHaveTextContent('FoodLeads: 3');
    expect(rows[1]).not.toHaveClass('is-dimmed');
    expect(rows[0]).toHaveClass('is-dimmed');
    expect(rows[2]).toHaveClass('is-dimmed');
    fireEvent.pointerLeave(container.querySelector('.bars')!);
    expect(container.querySelector('.is-dimmed')).toBeNull();
    expect(container.querySelector('.chart-tip')).toBeNull();
  });

  it('works from the keyboard too', () => {
    const { container } = render(chart());
    const rows = container.querySelectorAll('.bar-row');
    fireEvent.focus(rows[2]!);
    expect(rows[2]!.querySelector('.chart-tip')).toHaveTextContent('WoodLeads: 1');
  });

  it('says so when there is nothing to show, and keeps the table', () => {
    render(chart({ bars: [] }));
    expect(screen.getByText('No leads in this range.')).toBeVisible();
  });

  it('has the same numbers as a table for screen readers', () => {
    render(chart());
    expect(screen.getAllByRole('row').map((r) => r.textContent)).toEqual([
      'SectorLeads',
      'TextileLeads: 6',
      'FoodLeads: 3',
      'WoodLeads: 1',
    ]);
  });
});
