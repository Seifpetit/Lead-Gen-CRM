import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes, funnel, page, run } from '../../test/fixtures.js';
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
  it('has the four sections in the sidebar, with the profile at the bottom', async () => {
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
    const profile = screen.getByText('seif@example.test').closest('.sidebar-profile');
    expect(profile).not.toBeNull();
    expect(within(profile as HTMLElement).getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('renders the Dashboard, with no active run', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Create run (0/2)' })).toBeVisible();
    expect(await screen.findByText('No active run')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Results' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
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

  it('opens the start-run flow from Create run', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    expect(screen.queryByRole('region', { name: 'Start a run' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Create run' }));
    expect(await screen.findByRole('region', { name: 'Start a run' })).toBeVisible();
    expect(await screen.findByLabelText('Region')).toBeVisible();
  });

  it('shows the active run, its spend progress with checkpoints and its logs', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/runs': (req) =>
        req.query.has('status') ? page([activeRun]) : page([activeRun, run()]),
    });
    renderApp(server, '/leadgen');
    expect(await screen.findByRole('region', { name: 'Create run (1/2)' })).toBeVisible();
    const link = await screen.findAllByRole('link', { name: 'Run active: sfax' });
    expect(link[0]).toHaveAttribute('href', '/leadgen/runs/run-live');
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar.querySelectorAll('.progress-tick')).toHaveLength(3);
    const box = screen.getByRole('heading', { name: 'Logs', level: 3 }).closest('.log-box')!;
    const popout = within(box as HTMLElement).getByRole('link', { name: 'Open new window' });
    expect(popout).toHaveAttribute('href', '/leadgen/logs');
    expect(popout).toHaveAttribute('target', '_blank');
  });

  it('sums the results across runs and links to the leads', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/runs': (req) =>
        req.query.has('status')
          ? page([])
          : page([
              run({ id: 'a', funnel: funnel({ discovered: 40, peopleFound: 9, enriched: 8 }) }),
              run({ id: 'b', funnel: funnel({ discovered: 10, peopleFound: 1, enriched: 2 }) }),
            ]),
    });
    renderApp(server, '/leadgen');
    const card = await screen.findByRole('region', { name: 'Results' });
    const counts = await within(card).findByText('50');
    expect(counts.closest('div')).toHaveTextContent('Companies discovered');
    expect(within(card).getByText('Contact channels (email)').closest('div')).toHaveTextContent(
      '10',
    );
    expect(within(card).getByRole('link', { name: 'Open recent discoveries' })).toHaveAttribute(
      'href',
      '/crm',
    );
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
