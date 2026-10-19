import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes, page, run } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderApp } from '../../test/render.js';

const signedIn = {
  ...dashboardRoutes(),
  'GET /api/auth/me': { body: { id: 'u1', email: 'seif@example.test' } },
  'GET /api/auth/config': {
    body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: false },
  },
};

const coverage = {
  regions: [{ regionId: 'sfax', name: 'Sfax' }],
  sectors: [{ id: 'textile', name: 'Textile' }],
  entries: [
    {
      regionId: 'sfax',
      sectorId: 'textile',
      queriesRun: 12,
      newPlaces: 40,
      leads: 5,
      spendUsd: 2.5,
      costPerLeadUsd: 0.5,
      state: 'yielding',
    },
  ],
};

const activeRun = run({
  id: 'run-live',
  status: 'running',
  currentStage: 'discover',
  budgetCapUsd: 2,
  spentUsd: 0.5,
  finishedAt: null,
});

describe('Lead Gen sidebar and pages', () => {
  it('has the four sections in the sidebar, with the profile at the top', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    const side = await screen.findByRole('navigation', { name: 'Lead Gen sections' });
    expect(
      within(side)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Coverage', 'Costs', 'Logs']);
    expect(within(side).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(side.closest('aside')!).getByRole('button', { name: /seif@example.test/ }),
    ).toBeVisible();
  });

  it('renders the Dashboard, with no active run', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Recent leads' })).toBeVisible();
    for (const button of screen.getAllByRole('button', { name: 'Create run' })) {
      expect(button).toBeEnabled();
    }
  });

  it('renders the Coverage page: matrix, map and history', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/coverage');
    expect(await screen.findByRole('heading', { name: 'Coverage', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Coverage by sector' })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Coverage map' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'History results' })).toBeVisible();
  });

  it('renders the Costs page with the costs widget', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/costs');
    expect(await screen.findByRole('heading', { name: 'Costs', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Costs' })).toBeVisible();
  });

  it('renders the Logs page with the Apify log and Refresh now', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/logs');
    expect(await screen.findByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Apify log' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeVisible();
  });

  it('links the active run under the header and lists it in Runs with its spend', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/runs': (req) =>
        req.query.has('status') ? page([activeRun]) : page([activeRun, run()]),
    });
    renderApp(server, '/leadgen');
    const link = await screen.findByRole('link', { name: 'Run active: sfax' });
    expect(link).toHaveAttribute('href', '/leadgen/runs/run-live');
    const runs = await screen.findByRole('region', { name: 'Runs' });
    const row = within(runs).getAllByRole('link', { name: 'Open run for sfax' })[0]!;
    expect(row).toHaveAttribute('href', '/leadgen/runs/run-live');
    expect(within(row).getByText('$0.50 of $2.00')).toBeVisible();
  });

  it('has Settings and Help pages', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/help');
    expect(await screen.findByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
    expect(screen.getByText('What is the spend cap?')).toBeVisible();
  });

  it('opens the planning and lists past searches when a coverage square is clicked', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/coverage': coverage,
      'GET /api/runs': page([run({ id: 'old', sectors: ['textile'] })]),
    });
    renderApp(server, '/leadgen/coverage');
    await userEvent.click(await screen.findByRole('button', { name: /^Sfax, Textile/ }));
    expect(await screen.findByRole('region', { name: 'Start a run' })).toBeVisible();
    const history = screen.getByRole('region', { name: 'History results' });
    expect(await within(history).findByText('Past searches in Sfax for Textile')).toBeVisible();
    expect(within(history).getByRole('link', { name: 'Open run for sfax' })).toBeVisible();
  });

  it('toggles the matrix fullscreen', async () => {
    renderApp(fakeServer({ ...signedIn, 'GET /api/coverage': coverage }), '/leadgen/coverage');
    const matrix = await screen.findByRole('region', { name: 'Coverage by sector' });
    await userEvent.click(await within(matrix).findByRole('radio', { name: 'Fullscreen' }));
    const view = matrix.querySelector('.matrix-view')!;
    expect(view).toHaveClass('is-fullscreen');
    await userEvent.click(within(matrix).getByRole('radio', { name: 'Normal' }));
    expect(view).not.toHaveClass('is-fullscreen');
  });
});
