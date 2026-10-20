import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes, run } from '../../../test/fixtures.js';
import { fakeServer } from '../../../test/fakeServer.js';
import { renderApp } from '../../../test/render.js';
import { hidesBanner } from './LiveBanner.js';

const live = (id: string, region: string, sentence: string, over = {}) =>
  run({
    id,
    region,
    status: 'running',
    currentStage: 'discover',
    budgetCapUsd: 2.5,
    spentUsd: 0.48,
    finishedAt: null,
    liveMessage: sentence,
    stageFraction: 0.5,
    ...over,
  });

const serverWith = (runs: ReturnType<typeof live>[]) =>
  fakeServer({
    ...dashboardRoutes(),
    'GET /api/auth/me': { body: { id: 'u1', email: 'seif@example.test' } },
    'GET /api/auth/config': {
      body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: false },
    },
    'GET /api/runs/live': { runs },
  });

const one = live(
  'run-live',
  'Ben Arous',
  'Searching Google Maps for olive oil companies in Ben Arous...',
);

describe('Live run banner', () => {
  it('sits right under the app header, before the sidebar and the page', async () => {
    renderApp(serverWith([one]), '/leadgen');
    const banner = await screen.findByRole('region', { name: 'Runs in progress' });
    const header = document.querySelector('header.topbar')!;
    expect(header.nextElementSibling).toBe(banner);
    expect(banner.compareDocumentPosition(document.querySelector('.shell')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const link = within(banner).getByRole('link', { name: /Searching Google Maps for olive oil/ });
    expect(link).toHaveAttribute('href', '/leadgen/runs/run-live');
    expect(within(banner).getByText('$0.48 of $2.50')).toBeVisible();
    const bar = within(banner).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '8');
  });

  it.each(['/leadgen/coverage', '/leadgen/costs', '/leadgen/help'])(
    'shows on %s too, with the same slim row',
    async (path) => {
      renderApp(serverWith([one]), path);
      const banner = await screen.findByRole('region', { name: 'Runs in progress' });
      expect(within(banner).getAllByRole('listitem')).toHaveLength(1);
    },
  );

  it('shows two runs, one row each', async () => {
    renderApp(
      serverWith([
        live('run-a', 'Sfax', 'Looking up the people who work there...'),
        live('run-b', 'Tunis', 'Found 24 companies, checking which ones move goods...'),
      ]),
      '/leadgen/costs',
    );
    const banner = await screen.findByRole('region', { name: 'Runs in progress' });
    expect(within(banner).getAllByRole('progressbar')).toHaveLength(2);
  });

  it('is not drawn on the Runs page, which shows the runs in full', async () => {
    renderApp(serverWith([one]), '/leadgen/runs/run-live');
    await screen.findByRole('heading', { name: 'Runs', level: 1 });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Runs in progress' })).toBeNull(),
    );
    expect(hidesBanner('/leadgen/runs')).toBe(true);
    expect(hidesBanner('/leadgen/runs/abc')).toBe(true);
    expect(hidesBanner('/leadgen/runsish')).toBe(false);
    expect(hidesBanner('/leadgen')).toBe(false);
  });

  it('draws nothing when no run is in progress, so the page keeps the room', async () => {
    renderApp(serverWith([]), '/leadgen');
    await screen.findByRole('region', { name: 'Recent leads' });
    expect(screen.queryByRole('region', { name: 'Runs in progress' })).toBeNull();
    expect(document.querySelector('.live-strip')).toBeNull();
  });

  it('speaks a changed sentence politely, not every change', async () => {
    renderApp(serverWith([one]), '/leadgen/costs');
    const banner = await screen.findByRole('region', { name: 'Runs in progress' });
    const announcer = banner.querySelector('[aria-live="polite"]')!;
    await waitFor(() =>
      expect(announcer).toHaveTextContent(
        'Ben Arous: Searching Google Maps for olive oil companies in Ben Arous...',
      ),
    );
  });
});
