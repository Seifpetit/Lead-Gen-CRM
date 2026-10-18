import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.js';

const common = {
  brand: 'Lead Gen CRM',
  skipLabel: 'Skip to content',
  topNavLabel: 'Main',
  topNav: [
    { to: '/leadgen', label: 'Lead Gen' },
    { to: '/crm', label: 'CRM' },
  ],
  profile: <button type="button">Sign out</button>,
};
const sideNav = [
  { to: '/leadgen', label: 'Dashboard', end: true },
  { to: '/leadgen/coverage', label: 'Coverage' },
  { to: '/leadgen/costs', label: 'Costs' },
  { to: '/leadgen/logs', label: 'Logs' },
];

function shell(path: string, withSidebar: boolean) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell {...common} {...(withSidebar ? { sideNav, sideNavLabel: 'Sections' } : {})}>
        <main id="main">Page</main>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('has the top bar with the brand and tabs, and the page inside', () => {
    shell('/leadgen', true);
    expect(screen.getByText('Lead Gen CRM')).toBeVisible();
    const top = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(top)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Lead Gen', 'CRM']);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveTextContent('Page');
  });

  it('has a sidebar with the profile at the bottom, marking the current section', () => {
    const { container } = shell('/leadgen/costs', true);
    const side = screen.getByRole('navigation', { name: 'Sections' });
    expect(
      within(side)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Coverage', 'Costs', 'Logs']);
    expect(within(side).getByRole('link', { name: 'Costs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(side).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
    const aside = container.querySelector('aside')!;
    expect(aside.lastElementChild).toContainElement(
      screen.getByRole('button', { name: 'Sign out' }),
    );
    expect(container.querySelector('.topbar-user')).toBeNull();
  });

  it('puts the profile in the top bar when there is no sidebar', () => {
    const { container } = shell('/crm', false);
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('.topbar-user')).toContainElement(
      screen.getByRole('button', { name: 'Sign out' }),
    );
  });
});
