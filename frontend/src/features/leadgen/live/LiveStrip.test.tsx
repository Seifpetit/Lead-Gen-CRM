import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../../../test/fakeServer.js';
import { run } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { LiveStrip } from './LiveStrip.js';

const going = (over = {}) =>
  run({
    id: 'run-a',
    region: 'sfax',
    status: 'running',
    currentStage: 'discover',
    stageFraction: 0.3,
    finishedAt: null,
    liveMessage: 'Searching Google Maps…',
    ...over,
  });
const problem = (kind: 'provider_down' | 'stuck' | 'spend_fast' | 'retrying', message: string) => ({
  kind,
  message,
  since: '2026-10-19T14:20:00.000Z',
  action: kind === 'retrying' ? null : kind === 'stuck' ? ('recheck' as const) : ('stop' as const),
});

beforeEach(() => window.localStorage.clear());

describe('the live banner', () => {
  it('draws nothing when no run is going and none just ended', () => {
    const server = fakeServer({});
    const { container } = renderWith(<LiveStrip runs={[]} />, server);
    expect(container.querySelector('.live-strip')).toBeNull();
  });

  it('shows a run with no problem as before, without any alert', () => {
    renderWith(<LiveStrip runs={[going()]} />, fakeServer({}));
    expect(screen.getByText('Searching Google Maps…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says in plain words that a provider is out of credit, with a Stop action', async () => {
    const user = userEvent.setup();
    renderWith(
      <LiveStrip
        runs={[
          going({
            problem: problem('provider_down', 'Apify is out of credit: top up and start a new run'),
          }),
        ]}
      />,
      fakeServer({}),
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Apify is out of credit: top up and start a new run');
    expect(alert).toHaveTextContent('since 14:20 UTC');
    expect(within(alert).queryByRole('button', { name: 'Check again' })).toBeNull();
    await user.click(within(alert).getByRole('button', { name: 'Stop run' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('says a run looks stuck since when, and Check again asks the server', async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      'POST /api/runs/run-a/recheck': { body: going() },
    });
    let changed = 0;
    renderWith(
      <LiveStrip
        runs={[
          going({ problem: problem('stuck', 'This run looks stuck while searching Google Maps') }),
        ]}
        onChanged={() => (changed += 1)}
      />,
      server,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This run looks stuck while searching Google Maps');
    expect(alert).toHaveTextContent('since 14:20 UTC');
    await user.click(within(alert).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(server.to('POST /api/runs/run-a/recheck')).toHaveLength(1));
    await waitFor(() => expect(changed).toBe(1));
  });

  it('says so when the check could not be made', async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      'POST /api/runs/run-a/recheck': { status: 500, body: { error: 'internal' } },
    });
    renderWith(
      <LiveStrip runs={[going({ problem: problem('stuck', 'This run looks stuck') })]} />,
      server,
    );
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Could not check the run/)).toBeInTheDocument();
  });

  it('shows a retry calmly: a status, no buttons', () => {
    renderWith(
      <LiveStrip
        runs={[going({ problem: problem('retrying', 'Searching again after a provider hiccup') })]}
      />,
      fakeServer({}),
    );
    const status = screen.getByRole('status', { name: /Problem with the run/ });
    expect(status).toHaveTextContent('Searching again after a provider hiccup');
    expect(within(status).queryByRole('button')).toBeNull();
  });

  it('covers two runs at once, each with its own problem', () => {
    renderWith(
      <LiveStrip
        runs={[
          going({ problem: problem('stuck', 'This run looks stuck while checking companies') }),
          going({
            id: 'run-b',
            region: 'tunis',
            problem: problem('spend_fast', 'Spending is ahead of the estimate'),
          }),
        ]}
      />,
      fakeServer({}),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('keeps a failed run in view in plain words until it is dismissed', async () => {
    const user = userEvent.setup();
    const failed = run({
      id: 'run-f',
      region: 'sfax',
      status: 'failed',
      error: 'Apify is out of credit: top up and start a new run',
    });
    const view = renderWith(<LiveStrip runs={[]} ended={[failed]} />, fakeServer({}));
    expect(screen.getByRole('link', { name: /out of credit/ })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-f',
    );
    await user.click(screen.getByRole('button', { name: /Dismiss the message about the run/ }));
    expect(view.container.querySelector('.live-strip')).toBeNull();
    // It stays dismissed on a later visit.
    view.unmount();
    const again = renderWith(<LiveStrip runs={[]} ended={[failed]} />, fakeServer({}));
    expect(again.container.querySelector('.live-strip')).toBeNull();
  });

  it('shows a stopped run too', () => {
    renderWith(
      <LiveStrip runs={[]} ended={[run({ id: 'run-s', status: 'cancelled', error: null })]} />,
      fakeServer({}),
    );
    expect(screen.getByLabelText('Runs in progress')).toBeInTheDocument();
    expect(screen.getByText('Stopped by you')).toBeInTheDocument();
  });

  it('says when live updates dropped, and when the server cannot be reached', () => {
    const first = renderWith(<LiveStrip runs={[going()]} mode="polling" />, fakeServer({}));
    expect(screen.getByRole('status')).toHaveTextContent('Live updates paused');
    first.unmount();
    renderWith(<LiveStrip runs={[going()]} mode="polling" unreachable />, fakeServer({}));
    expect(screen.getByRole('status')).toHaveTextContent('Having trouble reaching the server');
  });
});
