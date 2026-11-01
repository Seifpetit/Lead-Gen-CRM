import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { dashboardRoutes, page } from '../../test/fixtures.js';
import { renderApp } from '../../test/render.js';
import { STAGES } from '../crm/boardTestKit.js';

const signedIn = {
  ...dashboardRoutes(),
  'GET /api/auth/me': { body: { id: 'u1', email: 'seif@example.test' } },
  'GET /api/auth/config': {
    body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: false },
  },
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

const switchButton = () => screen.findByRole('button', { name: /^Country: .*Change country$/ });

describe('country switch', () => {
  it('starts in Tunisia and asks the server for Tunisia only', async () => {
    const server = fakeServer(signedIn);
    renderApp(server, '/leadgen');
    expect(await switchButton()).toBeVisible();
    await waitFor(() => expect(server.to('GET /api/regions').length).toBeGreaterThan(0));
    for (const call of server.to('GET /api/regions')) {
      expect(call.query.get('country')).toBe('TN');
    }
  });

  it('greys out a country that is switched off and says why, and cannot pick it', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    await userEvent.click(await switchButton());
    const menu = screen.getByRole('list', { name: 'Country' });
    const germany = within(menu).getByRole('button', { name: /Germany/ });
    expect(germany).toBeDisabled();
    expect(within(menu).getAllByText(/Switched off: Switched off until France/)).toHaveLength(2);
    expect(within(menu).getByRole('button', { name: /^France/ })).toBeEnabled();
    // "All countries" belongs to the boards only.
    expect(within(menu).queryByRole('button', { name: 'All countries' })).not.toBeInTheDocument();
  });

  it('changes what every list asks for at once, without reloading, and remembers it', async () => {
    const server = fakeServer(signedIn);
    renderApp(server, '/leadgen');
    await userEvent.click(await switchButton());
    await userEvent.click(screen.getByRole('button', { name: /^France/ }));
    await waitFor(() => {
      const calls = server.to('GET /api/regions');
      expect(calls[calls.length - 1]!.query.get('country')).toBe('FR');
    });
    expect(
      await screen.findByRole('button', { name: 'Country: France. Change country' }),
    ).toBeVisible();
    expect(window.localStorage.getItem('leadgen.country')).toBe('FR');
    expect(new URL(window.location.href).searchParams.get('country')).toBe('FR');
  });

  it('opens in the country this browser remembers', async () => {
    window.localStorage.setItem('leadgen.country', 'FR');
    const server = fakeServer(signedIn);
    renderApp(server, '/leadgen');
    expect(
      await screen.findByRole('button', { name: 'Country: France. Change country' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(server.to('GET /api/regions').length).toBeGreaterThan(0));
    expect(server.to('GET /api/regions')[0]!.query.get('country')).toBe('FR');
  });

  it('falls back to Tunisia when the remembered country has been switched off', async () => {
    window.localStorage.setItem('leadgen.country', 'DE');
    renderApp(fakeServer(signedIn), '/leadgen');
    expect(
      await screen.findByRole('button', { name: 'Country: Tunisia. Change country' }),
    ).toBeInTheDocument();
  });

  it('offers "All countries" on the boards and then asks for every country', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/crm/companies': {
        pipeline: 'companies',
        stages: STAGES.companies.map((st) => ({ ...st, cards: [], total: 0, nextCursor: null })),
        sectors: [],
      },
    });
    renderApp(server, '/crm/companies');
    await userEvent.click(await switchButton());
    await userEvent.click(screen.getByRole('button', { name: 'All countries' }));
    await waitFor(() => {
      const calls = server.to('GET /api/crm/companies');
      expect(calls.length).toBeGreaterThan(1);
      expect(calls[calls.length - 1]!.query.has('country')).toBe(false);
    });
    expect(server.to('GET /api/crm/companies')[0]!.query.get('country')).toBe('TN');
  });

  it('keeps Costs and the run list across countries, with a Country column', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/costs': page([
        { key: 'r1', country: 'FR', openEstimateUsd: 0, actualUsd: 1, totalUsd: 1, entries: 2 },
        { key: 'r2', country: 'TN', openEstimateUsd: 0, actualUsd: 2, totalUsd: 2, entries: 3 },
      ]),
    });
    window.localStorage.setItem('leadgen.country', 'FR');
    renderApp(server, '/leadgen/costs');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Country' })).toBeInTheDocument();
    expect(within(table).getByText('FR')).toBeInTheDocument();
    expect(within(table).getByText('TN')).toBeInTheDocument();
    for (const call of server.to('GET /api/costs')) expect(call.query.has('country')).toBe(false);
  });
});

describe('data-protection notice', () => {
  it('shows once, the first time someone works in a European country, and not in Tunisia', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    await switchButton();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(await switchButton());
    await userEvent.click(screen.getByRole('button', { name: /^France/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Before you search in France' });
    expect(within(dialog).getByText(/GDPR/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'I understand' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.localStorage.getItem('leadgen.gdpr.accepted')).toBe('1');
  });

  it('does not come back once accepted', async () => {
    window.localStorage.setItem('leadgen.gdpr.accepted', '1');
    window.localStorage.setItem('leadgen.country', 'FR');
    renderApp(fakeServer(signedIn), '/leadgen');
    await screen.findByRole('button', { name: 'Country: France. Change country' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
