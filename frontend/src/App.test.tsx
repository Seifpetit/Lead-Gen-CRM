import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes } from './test/fixtures.js';
import { fakeServer } from './test/fakeServer.js';
import { renderApp } from './test/render.js';

const signedIn = {
  ...dashboardRoutes(),
  'GET /api/auth/me': { body: { id: 'u1', email: 'seif@example.test' } },
  'GET /api/auth/config': {
    body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: false },
  },
};

describe('App', () => {
  it('has Lead Gen first, then CRM, with the signed-in user and sign out', async () => {
    renderApp(fakeServer(signedIn), '/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Lead Gen', 'CRM']);
    expect(screen.getByText('seif@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
  });

  it('shows the dashboard cards and previous runs', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    for (const name of ['Create run (0/2)', 'Results', 'Runs']) {
      expect(await screen.findByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('marks the current page in the navigation', async () => {
    renderApp(fakeServer(signedIn), '/crm');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'CRM' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Lead Gen' })).not.toHaveAttribute('aria-current');
  });

  it('signs out through the API and returns to the sign-in screen', async () => {
    const server = fakeServer({ ...signedIn, 'POST /api/auth/logout': { status: 204 } });
    renderApp(server, '/leadgen');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(server.to('POST /api/auth/logout')).toHaveLength(1);
  });

  it('returns to sign-in when the session ends while using the app', async () => {
    let expired = false;
    const server = fakeServer({
      ...signedIn,
      'GET /api/runs': () =>
        expired
          ? { status: 401, body: { error: 'unauthenticated' } }
          : { body: { items: [], total: 0 } },
      'GET /api/leads': () => ({ status: 401, body: { error: 'unauthenticated' } }),
    });
    renderApp(server, '/leadgen');
    await screen.findByRole('region', { name: 'Runs' });
    expired = true;
    await userEvent.click(screen.getByRole('link', { name: 'CRM' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });

  it('has a page for unknown addresses', async () => {
    renderApp(fakeServer(signedIn), '/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('lets keyboard users skip to the content', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    );
  });
});
