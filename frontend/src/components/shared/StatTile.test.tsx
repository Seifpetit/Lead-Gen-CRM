import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile } from './StatTile.js';

describe('StatTile', () => {
  it('shows the label, the number and the hint', () => {
    render(
      <dl>
        <StatTile label="People found" value="1,204" hint="from 3 runs" />
      </dl>,
    );
    expect(screen.getByText('People found').tagName).toBe('DT');
    expect(screen.getByText('1,204')).toHaveClass('stat-value');
    expect(screen.getByText('from 3 runs')).toBeVisible();
  });

  it('leaves the hint out when there is none', () => {
    const { container } = render(
      <dl>
        <StatTile label="Companies" value={0} />
      </dl>,
    );
    expect(container.querySelector('.stat-hint')).toBeNull();
    expect(screen.getByText('0')).toBeVisible();
  });
});
