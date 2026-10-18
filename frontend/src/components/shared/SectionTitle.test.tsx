import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionTitle } from './SectionTitle.js';

describe('SectionTitle', () => {
  it('renders the heading at the level asked for, with an optional hint', () => {
    render(
      <SectionTitle level={1} hint="Where the money went">
        Costs
      </SectionTitle>,
    );
    expect(screen.getByRole('heading', { name: 'Costs', level: 1 })).toBeVisible();
    expect(screen.getByText('Where the money went')).toBeVisible();
  });

  it('defaults to a second-level heading without a hint', () => {
    const { container } = render(<SectionTitle>Logs</SectionTitle>);
    expect(screen.getByRole('heading', { name: 'Logs', level: 2 })).toBeVisible();
    expect(container.querySelector('p')).toBeNull();
  });
});
