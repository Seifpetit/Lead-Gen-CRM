import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApifyLog } from '@lead-gen-crm/shared';
import { fakeServer } from '../../test/fakeServer.js';
import { emptyApifyLog, page, run } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { APIFY_LOG_POLL_MS, ApifyLogWidget } from './ApifyLogWidget.js';

const step = (state: ApifyLog['runs'][number]['steps'][number]['latestState']) => ({
  runStepId: 's1',
  stage: 'discover' as const,
  stepKey: 'discover:r0c0',
  actorId: 'actor',
  apifyRunId: 'ap1',
  apifyStatus: null,
  latestState: state,
  history: [
    {
      id: 'e1',
      runId: 'run-1',
      runStepId: 's1',
      apifyRunId: 'ap1',
      state: 'started' as const,
      message: null,
      occurredAt: '2026-10-18T09:00:00.000Z',
    },
    ...(state && state !== 'started'
      ? [
          {
            id: 'e2',
            runId: 'run-1',
            runStepId: 's1',
            apifyRunId: 'ap1',
            state,
            message: null,
            occurredAt: '2026-10-18T09:05:00.000Z',
          },
        ]
      : []),
  ],
});

const logWith = (state: Parameters<typeof step>[0], attention = false): ApifyLog => ({
  runs: [{ run: run({ status: 'running', currentStage: 'discover' }), steps: [step(state)] }],
  attention: attention ? [step(state)] : [],
  recent: page(step(state).history.slice().reverse()),
});

describe('Apify log widget', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('shows an empty state before any run', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': emptyApifyLog() }),
    );
    expect(await screen.findByText('No runs to show')).toBeInTheDocument();
  });

  it('shows the state of each Apify run and the latest state changes', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': logWith('running') }),
    );
    const runs = await screen.findByText('Run in sfax');
    expect(runs).toBeInTheDocument();
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    const recent = screen.getByRole('list', { name: 'Latest state changes' });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(2);
  });

  it('calls out runs that restarted or resumed', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': logWith('restarting', true) }),
    );
    expect(
      await screen.findByText(/Needs attention: 1 Apify run restarted or resumed/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Restarting').length).toBeGreaterThan(0);
  });

  it('refreshes by polling', async () => {
    let state: Parameters<typeof step>[0] = 'running';
    const server = fakeServer({ 'GET /api/apify/log': () => logWith(state) });
    renderWith(<ApifyLogWidget refreshKey={0} />, server);
    await screen.findByText('Run in sfax');
    expect(screen.queryByText('Finished')).not.toBeInTheDocument();

    state = 'finished';
    await act(() => vi.advanceTimersByTimeAsync(APIFY_LOG_POLL_MS + 100));
    expect((await screen.findAllByText('Finished')).length).toBeGreaterThan(0);
    expect(server.to('GET /api/apify/log').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps showing the last state when a refresh fails', async () => {
    let fail = false;
    const server = fakeServer({
      'GET /api/apify/log': () =>
        fail ? { status: 500, body: { error: 'internal' } } : logWith('running'),
    });
    renderWith(<ApifyLogWidget refreshKey={0} />, server);
    await screen.findByText('Run in sfax');
    fail = true;
    await act(() => vi.advanceTimersByTimeAsync(APIFY_LOG_POLL_MS + 100));
    expect(await screen.findByText(/Showing the last known state/)).toBeInTheDocument();
    expect(screen.getByText('Run in sfax')).toBeInTheDocument();
  });
});
