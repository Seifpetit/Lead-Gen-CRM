import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SettingsPage } from '../InfoPages.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { fakeServer } from '../../../test/fakeServer.js';
import { health } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { HealthNotice } from './HealthNotice.js';
import { HealthPanel } from './HealthPanel.js';

const down = (over = {}) =>
  health({
    providers: [
      {
        provider: 'apify',
        state: 'down',
        kind: 'out_of_credit',
        reason: 'Apify is out of credit: top up and start a new run',
        since: '2026-10-19T14:20:00.000Z',
        lastOkAt: null,
      },
      { provider: 'anthropic', state: 'ok', kind: null, reason: null, since: null, lastOkAt: null },
    ],
    notices: [
      { id: 'provider:apify', message: 'Apify is out of credit: top up and start a new run' },
    ],
    ...over,
  });

describe('Health panel', () => {
  it('shows every service as working on a healthy install, and no errors', async () => {
    renderWith(<HealthPanel />, fakeServer({}));
    expect(await screen.findByText('Apify (finds places and people)')).toBeInTheDocument();
    expect(screen.getAllByText('Working')).toHaveLength(2);
    expect(screen.getByText('No errors recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I fixed/ })).toBeNull();
  });

  it('says in plain words what is wrong and lets the person say they fixed it', async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      'GET /api/health': { body: down() },
      'POST /api/health/providers/apify/reset': { body: health() },
    });
    renderWith(<HealthPanel />, server);
    expect(
      await screen.findByText(/Apify is out of credit: top up and start a new run/),
    ).toBeInTheDocument();
    expect(screen.getByText('Not working')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /I fixed Apify/ }));
    await waitFor(() =>
      expect(server.to('POST /api/health/providers/apify/reset')).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByText('Not working')).toBeNull());
  });

  it('lists key checks, pending migrations and what to do', async () => {
    renderWith(
      <HealthPanel />,
      fakeServer({
        'GET /api/health': {
          body: health({
            checks: [
              {
                id: 'apify_token',
                status: 'fail',
                message: 'The Apify key (APIFY_TOKEN) is missing.',
              },
              { id: 'anthropic_key', status: 'warn', message: 'The Anthropic key is not set.' },
              { id: 'migrations', status: 'fail', message: '1 database update is waiting.' },
            ],
            pendingMigrations: ['014_failure_tracking'],
            warnings: [{ kind: 'daily_spend_jump', message: "Today's spend, $5.00, is high." }],
          }),
        },
      }),
    );
    expect(await screen.findByText('The Apify key (APIFY_TOKEN) is missing.')).toBeInTheDocument();
    expect(screen.getAllByText('Needs fixing')).toHaveLength(2);
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText('014_failure_tracking')).toBeInTheDocument();
    expect(screen.getByText(/npm run db:migrate/)).toBeInTheDocument();
    expect(screen.getByText("Today's spend, $5.00, is high.")).toBeInTheDocument();
  });

  it('lists the last errors with how often each came back, technical detail folded', async () => {
    renderWith(
      <HealthPanel />,
      fakeServer({
        'GET /api/health': {
          body: health({
            errors: [
              {
                id: 'e1',
                source: 'provider',
                provider: 'apify',
                step: 'discover',
                runId: null,
                kind: 'out_of_credit',
                message: 'Apify is out of credit',
                stack: 'at call (x.ts:1:1)',
                count: 3,
                firstSeen: '2026-10-19T13:00:00.000Z',
                lastSeen: '2026-10-19T14:20:00.000Z',
              },
              {
                id: 'e2',
                source: 'request',
                provider: null,
                step: 'GET /api/x',
                runId: null,
                kind: 'unhandled',
                message: 'Something broke',
                stack: null,
                count: 1,
                firstSeen: '2026-10-19T13:00:00.000Z',
                lastSeen: '2026-10-19T13:00:00.000Z',
              },
            ],
          }),
        },
      }),
    );
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('3 times')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Once')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Technical detail')).toBeInTheDocument();
  });

  it('says so when it cannot be read', async () => {
    renderWith(
      <HealthPanel />,
      fakeServer({ 'GET /api/health': { status: 500, body: { error: 'internal' } } }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('the in-app notice', () => {
  it('draws nothing while all is well', async () => {
    const server = fakeServer({});
    const { container } = renderWith(<HealthNotice />, server);
    await waitFor(() => expect(server.to('GET /api/health')).toHaveLength(1));
    expect(container.querySelector('.health-notice')).toBeNull();
  });

  it('shows a provider that is down, in plain words, linking to Health', async () => {
    renderWith(<HealthNotice />, fakeServer({ 'GET /api/health': { body: down() } }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Apify is out of credit: top up and start a new run');
    expect(within(alert).getByRole('link', { name: 'Open Health' })).toHaveAttribute(
      'href',
      '/leadgen/settings?tab=health',
    );
  });

  it('shows a refused key and waiting updates as separate lines', async () => {
    renderWith(
      <HealthNotice />,
      fakeServer({
        'GET /api/health': {
          body: health({
            notices: [
              { id: 'provider:anthropic', message: 'Anthropic refused the key: check it' },
              { id: 'check:migrations', message: '1 database update is waiting' },
            ],
          }),
        },
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('Settings', () => {
  const show = (at: string, server = fakeServer({})) =>
    renderWith(
      <AuthProvider>
        <Routes>
          <Route path="/leadgen/settings" element={<SettingsPage />} />
        </Routes>
      </AuthProvider>,
      server,
      at,
    );

  it('opens on General and switches to Health', async () => {
    const user = userEvent.setup();
    const server = fakeServer({ 'GET /api/auth/me': { body: { id: 'u1', email: 'a@b.tn' } } });
    show('/leadgen/settings', server);
    expect(await screen.findByRole('tab', { name: 'General', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Health' }));
    expect(await screen.findByText('Apify (finds places and people)')).toBeInTheDocument();
  });

  it('opens straight on Health from the notice link', async () => {
    const server = fakeServer({ 'GET /api/auth/me': { body: { id: 'u1', email: 'a@b.tn' } } });
    show('/leadgen/settings?tab=health', server);
    expect(await screen.findByRole('tab', { name: 'Health', selected: true })).toBeInTheDocument();
  });
});
