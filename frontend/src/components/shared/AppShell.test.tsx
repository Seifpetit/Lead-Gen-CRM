import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  profileName: 'seif@example.test',
  profile: <button type="button">Sign out</button>,
};
const sideNav = [
  {
    id: 'overview',
    items: [{ to: '/leadgen', label: 'Dashboard', end: true, badge: 3, badgeLabel: '3 new leads' }],
  },
  {
    id: 'insight',
    items: [
      { to: '/leadgen/coverage', label: 'Coverage' },
      { to: '/leadgen/costs', label: 'Costs' },
    ],
  },
  { id: 'activity', items: [{ to: '/leadgen/logs', label: 'Logs' }] },
];
const sideFooter = [
  { to: '/leadgen/settings', label: 'Settings' },
  { to: '/leadgen/help', label: 'Help' },
];

function shell(path: string, withSidebar: boolean) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell
        {...common}
        {...(withSidebar
          ? {
              sideNav,
              sideFooter,
              sideNavLabel: 'Sections',
              collapseLabel: 'Collapse sidebar',
              expandLabel: 'Expand sidebar',
            }
          : {})}
      >
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

  it('has a sidebar with groups, the current section marked, and a count badge', () => {
    shell('/leadgen/costs', true);
    const side = screen.getByRole('navigation', { name: 'Sections' });
    expect(
      within(side)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard3', 'Coverage', 'Costs', 'Logs']);
    expect(within(side).getByRole('link', { name: /Costs/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(side).getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(side).getByLabelText('3 new leads')).toHaveTextContent('3');
    expect(side.querySelectorAll('.nav-group')).toHaveLength(3);
  });

  it('has the profile at the top of the sidebar, opening a menu with a chevron button', async () => {
    const { container } = shell('/leadgen', true);
    const aside = container.querySelector('aside')!;
    expect(aside.firstElementChild).toContainElement(
      screen.getByRole('button', { name: /seif@example.test/ }),
    );
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /seif@example.test/ }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('has Settings and Help at the bottom', () => {
    const { container } = shell('/leadgen', true);
    const footer = container.querySelector('.sidebar-footer')!;
    expect(
      within(footer as HTMLElement)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Settings', 'Help']);
    expect(container.querySelector('aside')!.lastElementChild).toBe(footer);
  });

  it('folds down to icons only and back', async () => {
    const { container } = shell('/leadgen', true);
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(container.querySelector('.shell')).toHaveClass('is-collapsed');
    // The links keep their names for screen readers.
    expect(screen.getByRole('link', { name: /Coverage/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(container.querySelector('.shell')).not.toHaveClass('is-collapsed');
  });

  it('puts the profile in the top bar when there is no sidebar', () => {
    const { container } = shell('/crm', false);
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('.topbar-user')).toContainElement(
      screen.getByRole('button', { name: /seif@example.test/ }),
    );
  });
});
