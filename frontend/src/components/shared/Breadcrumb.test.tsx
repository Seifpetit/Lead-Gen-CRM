import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Breadcrumb } from './Breadcrumb.js';

describe('Breadcrumb', () => {
  it('shows where you are and a Back link to the page above', () => {
    render(
      <MemoryRouter>
        <Breadcrumb
          label="You are here"
          backLabel="Back"
          crumbs={[
            { label: 'Dashboard', to: '/leadgen' },
            { label: 'Run in Sfax', to: '/leadgen/runs/r1' },
            { label: 'Fixture Transport' },
          ]}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'You are here' });
    expect(nav).toHaveTextContent('DashboardRun in SfaxFixture Transport');
    expect(screen.getByText('Fixture Transport')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/leadgen');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/leadgen/runs/r1');
  });
});
