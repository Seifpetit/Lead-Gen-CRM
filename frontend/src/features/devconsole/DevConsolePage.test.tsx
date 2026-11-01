import type {
  DevDiscoverOutput,
  DevEstimate,
  DevHistoryEntry,
  DevOptions,
} from '@lead-gen-crm/shared';
import { DEV_LIMITS } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { dashboardRoutes } from '../../test/fixtures.js';
import { renderApp } from '../../test/render.js';

const options: DevOptions = {
  countries: [
    { code: 'TN', name: 'Tunisia', languages: ['fr', 'en'] },
    { code: 'FR', name: 'France', languages: ['fr'] },
  ],
  areas: [
    {
      regionId: 'sfax',
      name: 'Sfax',
      country: 'TN',
      bounds: { south: 34.6, west: 10.5, north: 34.9, east: 10.9 },
      cells: [{ cellKey: 'r0c0', south: 34.6, west: 10.5, north: 34.9, east: 10.7 }],
    },
  ],
  classifierConfigured: true,
  classifierModel: 'claude-haiku-5-5',
  limits: DEV_LIMITS,
};

const estimate: DevEstimate = {
  step: 'discover',
  estimateUsd: 0.0123,
  capUsd: 1,
  lines: [{ label: 'importateur', usd: 0.0123 }],
  requests: [{ searchStringsArray: ['importateur'], language: 'fr' }],
  searches: 1,
  notice: null,
};

const output: DevDiscoverOutput = {
  requests: estimate.requests,
  searches: [
    {
      word: 'importateur',
      returned: 1,
      costUsd: 0.01,
      apifyRunId: 'abc',
      apifyRunUrl: 'https://console.apify.com/view/runs/abc',
      status: 'SUCCEEDED',
    },
  ],
  places: [
    {
      name: 'Huilerie Baccar',
      category: 'Huilerie',
      address: 'Sfax',
      phone: null,
      website: 'https://baccar.example',
      lat: 34.7,
      lng: 10.6,
      word: 'importateur',
      outsideRegion: false,
      alreadyKnown: false,
      noContact: false,
    },
  ],
  counts: { returned: 1, new: 1, outsideRegion: 0, alreadyKnown: 0, noContact: 0 },
  durationMs: 4200,
  skippedWords: [],
  notice: null,
};

const entry = (over: Partial<DevHistoryEntry> = {}): DevHistoryEntry => ({
  id: 'e1',
  step: 'discover',
  status: 'succeeded',
  summary: 'TN · importateur · 1 places',
  input: {
    country: 'TN',
    language: 'fr',
    words: ['importateur'],
    area: { kind: 'cell', regionId: 'sfax', cellKey: 'r0c0' },
    maxPlaces: 5,
    capUsd: 1,
  },
  output,
  costUsd: 0.01,
  error: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  by: 'test',
  ...over,
});

function routes(devConsole: boolean, history: DevHistoryEntry[] = []) {
  return {
    ...dashboardRoutes(),
    'GET /api/auth/me': { body: { id: 'u1', email: 'test', devConsole } },
    'GET /api/auth/config': {
      body: { signupMode: 'invite', minPasswordLength: 12, devAdminLogin: true },
    },
    'GET /api/dev/console/options': { body: options },
    'POST /api/dev/console/estimate': { body: estimate },
    'GET /api/dev/console/history': { body: { items: history } },
    'POST /api/dev/console/run': { status: 202, body: entry({ status: 'running', output: null }) },
    'GET /api/dev/console/history/e1': { body: entry() },
    'DELETE /api/dev/console/history': { status: 204 },
  };
}

describe('Dev console button', () => {
  it('is in the Dashboard header for the dev admin', async () => {
    renderApp(fakeServer(routes(true)), '/leadgen');
    expect(await screen.findByRole('link', { name: 'Dev console' })).toHaveAttribute(
      'href',
      '/dev/console',
    );
  });

  it('is not there for anyone else, and the page sends them back to the Dashboard', async () => {
    const server = fakeServer(routes(false));
    renderApp(server, '/leadgen');
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    expect(screen.queryByRole('link', { name: 'Dev console' })).not.toBeInTheDocument();
  });

  it('turns a visit to /dev/console into the Dashboard when it is off', async () => {
    const server = fakeServer(routes(false));
    renderApp(server, '/dev/console');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(server.to('GET /api/dev/console/options')).toHaveLength(0);
  });
});

describe('Dev console page', () => {
  async function open(history: DevHistoryEntry[] = []) {
    const server = fakeServer(routes(true, history));
    renderApp(server, '/dev/console');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Dev console', level: 1 });
    await screen.findByRole('tab', { name: 'Discover' });
    return { server, user };
  }

  async function addWord(user: ReturnType<typeof userEvent.setup>, word: string) {
    await user.type(await screen.findByLabelText(/Search words/), word);
    await user.click(screen.getByRole('button', { name: 'Add' }));
  }

  it('shows the exact request and the estimate once the form is valid, without spending', async () => {
    const { server, user } = await open();
    expect(screen.getByRole('button', { name: 'Confirm and run' })).toBeDisabled();
    await addWord(user, 'importateur');
    const box = await screen.findByRole('region', { name: 'Exact request' });
    expect(await within(box).findByText(/searchStringsArray/)).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Estimate $0.012');
    expect(server.to('POST /api/dev/console/estimate')[0]!.body).toMatchObject({
      step: 'discover',
      input: { words: ['importateur'], area: { kind: 'cell', cellKey: 'r0c0' }, capUsd: 1 },
    });
    expect(server.to('POST /api/dev/console/run')).toHaveLength(0);
  });

  it('spends only when the Modal’s confirm button is pressed', async () => {
    const { server, user } = await open();
    await addWord(user, 'importateur');
    const run = screen.getByRole('button', { name: 'Confirm and run' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);

    const dialog = await screen.findByRole('dialog', { name: 'Run this and spend money?' });
    expect(dialog).toHaveTextContent('about $0.012');
    expect(server.to('POST /api/dev/console/run')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(server.to('POST /api/dev/console/run')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Confirm and run' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and run' }),
    );
    await waitFor(() => expect(server.to('POST /api/dev/console/run')).toHaveLength(1));
    expect(server.to('POST /api/dev/console/run')[0]!.body.step).toBe('discover');
  });

  it('says plainly what is wrong instead of asking the server', async () => {
    const { server } = await open();
    expect(screen.getByText('Add 1 to 5 search words.')).toBeInTheDocument();
    expect(server.to('POST /api/dev/console/estimate')).toHaveLength(0);
  });

  it('opens a past call, and “Run again with edits” fills the form but runs nothing', async () => {
    const { server, user } = await open([entry()]);
    await user.click(await screen.findByRole('button', { name: /TN · importateur/ }));
    expect(await screen.findByText('Huilerie Baccar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SUCCEEDED' })).toHaveAttribute(
      'href',
      'https://console.apify.com/view/runs/abc',
    );

    await user.click(screen.getByRole('button', { name: 'Run again with edits' }));
    expect(await screen.findByText('importateur', { selector: '.dc-chip' })).toBeInTheDocument();
    expect(server.to('POST /api/dev/console/run')).toHaveLength(0);
  });

  it('carries the places of a result into the Classify tab', async () => {
    const { user } = await open([entry()]);
    await user.click(await screen.findByRole('button', { name: /TN · importateur/ }));
    await user.click(await screen.findByRole('button', { name: 'Use these places in Classify' }));
    expect(
      await screen.findByRole('tab', { name: 'Classify', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Huilerie Baccar')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://baccar.example')).toBeInTheDocument();
  });

  it('clears the history only after a confirmation', async () => {
    const { server, user } = await open([entry()]);
    await user.click(await screen.findByRole('button', { name: 'Clear history' }));
    expect(server.to('DELETE /api/dev/console/history')).toHaveLength(0);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear history' }));
    await waitFor(() => expect(server.to('DELETE /api/dev/console/history')).toHaveLength(1));
    expect(server.to('DELETE /api/dev/console/history')[0]!.query.get('step')).toBe('discover');
  });

  it('shows a call that is still running, and its result when it ends', async () => {
    let done = false;
    const server = fakeServer({
      ...routes(true, [entry({ status: 'running', output: null })]),
      'GET /api/dev/console/history/e1': () => ({
        body: done ? entry() : entry({ status: 'running', output: null }),
      }),
    });
    renderApp(server, '/dev/console');
    await screen.findByRole('tab', { name: 'Discover' });
    await user_wait();
    done = true;
    expect(await screen.findByText('Huilerie Baccar', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

const user_wait = () => new Promise((r) => setTimeout(r, 50));
