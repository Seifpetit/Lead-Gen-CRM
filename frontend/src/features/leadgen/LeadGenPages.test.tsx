import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dashboardRoutes, page, run } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderApp } from '../../test/render.js';

// jsdom cannot draw the Leaflet map on the Coverage page.
vi.mock('./worldmap/WorldMap.js', async () => ({
  WorldMap: (await import('../../test/fakeWorldMap.js')).FakeWorldMap,
}));

const signedIn = {
  ...dashboardRoutes(),
  'GET /api/auth/me': { body: { id: 'u1', email: 'seif@example.test' } },
  'GET /api/auth/config': {
    body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: false },
  },
};

const activeRun = run({
  id: 'run-live',
  status: 'running',
  currentStage: 'discover',
  budgetCapUsd: 2,
  spentUsd: 0.5,
  finishedAt: null,
  liveMessage: 'Searching Google Maps for textile companies in Sfax...',
});

describe('Lead Gen sidebar and pages', () => {
  it('has the four sections in the sidebar, with the profile at the top', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    const side = await screen.findByRole('navigation', { name: 'Lead Gen sections' });
    expect(
      within(side)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Coverage', 'Costs', 'Runs']);
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

  it('puts the country switch in the Dashboard header, as one of its filters', async () => {
    renderApp(fakeServer(signedIn), '/leadgen');
    const header = (await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).closest(
      'header',
    )!;
    expect(await within(header).findByRole('button', { name: /^Country:/ })).toBeVisible();
    // The sidebar's own switch steps aside, so there is only one.
    expect(screen.getAllByRole('button', { name: /^Country:/ })).toHaveLength(1);
  });

  it('renders the Coverage page as a world map with its own country picker', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/map/pins': { body: { items: [], total: 0 } },
    });
    renderApp(server, '/leadgen/coverage');
    expect(await screen.findByRole('heading', { name: 'Coverage', level: 1 })).toBeInTheDocument();
    expect(await screen.findByTestId('world-map')).toBeVisible();
    expect(await screen.findByRole('button', { name: /Coverage by region/ })).toBeVisible();
    // One picker, on the map: the sidebar's own switch steps aside on this page.
    expect(screen.getAllByRole('button', { name: /^Country:/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Coverage by sector' })).toBeNull();
  });

  it('renders the Costs page with the costs widget', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/costs');
    expect(await screen.findByRole('heading', { name: 'Costs', level: 1 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Costs' })).toBeVisible();
  });

  it('sends the old Logs address to the Runs page, on its Logs view, with filters and Refresh now', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/logs');
    expect(await screen.findByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Logs' })).toBeChecked();
    expect(await screen.findByText('No runs to show')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeVisible();
  });

  it('links the active run in the live strip and lists it in Runs with its spend', async () => {
    const server = fakeServer({
      ...signedIn,
      'GET /api/runs': (req) =>
        req.query.has('status') ? page([activeRun]) : page([activeRun, run()]),
      'GET /api/runs/live': { runs: [activeRun] },
    });
    renderApp(server, '/leadgen');
    const link = await screen.findByRole('link', {
      name: 'Searching Google Maps for textile companies in Sfax...',
    });
    expect(link).toHaveAttribute('href', '/leadgen/runs/run-live');
    const runs = await screen.findByRole('region', { name: 'Runs' });
    const row = within(runs).getAllByRole('link', { name: 'Open run for Sfax' })[0]!;
    expect(row).toHaveAttribute('href', '/leadgen/runs/run-live');
    expect(within(row).getByText('$0.50 of $2.00')).toBeVisible();
  });

  it('has Settings and Help pages', async () => {
    renderApp(fakeServer(signedIn), '/leadgen/help');
    expect(await screen.findByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
    expect(screen.getByText('What is the spend cap?')).toBeVisible();
  });
});
