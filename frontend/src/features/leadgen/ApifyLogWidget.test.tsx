import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApifyLog, ApifyStepView } from '@lead-gen-crm/shared';
import { fakeServer } from '../../test/fakeServer.js';
import { emptyApifyLog, page, run } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { APIFY_LOG_POLL_MS, ApifyLogWidget } from './ApifyLogWidget.js';

const step = (
  state: ApifyLog['runs'][number]['steps'][number]['latestState'],
  over: Partial<ApifyStepView> = {},
): ApifyStepView => ({
  target: { query: 'huilerie', cell: 'r0c1', company: null },
  summary: null,
  costUsd: 0.012,
  durationSeconds: 65,
  error: null,
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
  ...over,
});

const logWith = (
  state: Parameters<typeof step>[0],
  attention = false,
  over: Partial<ApifyStepView> = {},
): ApifyLog => ({
  runs: [{ run: run({ status: 'running', currentStage: 'discover' }), steps: [step(state, over)] }],
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

  it('shows the state of each Apify run', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': logWith('running') }),
    );
    const runs = await screen.findByText('Run in sfax');
    expect(runs).toBeInTheDocument();
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
  });

  it('says what a step searched, what came back, what was dropped, and what it cost', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({
        'GET /api/apify/log': logWith('finished', false, {
          summary: {
            returned: 20,
            kept: 16,
            dropped: [
              { reason: 'outside_region', count: 1 },
              { reason: 'no_contact', count: 3 },
            ],
          },
        }),
      }),
    );
    expect(await screen.findByText('Discover: “huilerie” in cell r0c1')).toBeInTheDocument();
    expect(
      screen.getByText('20 results, 16 kept, 4 dropped (dropped: outside region 1, no contact 3)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cost \$0\.012/)).toBeInTheDocument();
    expect(screen.getByText(/Took 1m 05s/)).toBeInTheDocument();
    expect(screen.getByText(/Actor actor/)).toBeInTheDocument();
  });

  it('links the Apify run ID to its console page', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': logWith('finished') }),
    );
    const link = await screen.findByRole('link', { name: 'ap1' });
    expect(link).toHaveAttribute('href', 'https://console.apify.com/actors/runs/ap1');
  });

  it('keeps the state-change timestamps in a collapsed details section', async () => {
    renderWith(
      <ApifyLogWidget refreshKey={0} />,
      fakeServer({ 'GET /api/apify/log': logWith('finished') }),
    );
    await screen.findByText('Discover: “huilerie” in cell r0c1');
    const details = screen.getByText('Details').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Latest state changes')).not.toBeInTheDocument();
  });

  it('says why a company had no decision-makers', async () => {
    const people = (company: string, over: object) =>
      step('finished', {
        runStepId: company,
        stage: 'find_people',
        target: { query: null, cell: null, company },
        summary: {
          returned: 3,
          kept: 0,
          dropped: [],
          people: { found: 3, decisionMakers: 0, noLinkedinPage: false, reasons: [], ...over },
        },
      });
    const log: ApifyLog = {
      runs: [
        {
          run: run({ status: 'finished' }),
          steps: [
            people('Huilerie Fixture', {
              reasons: [{ reason: 'no_matching_title', count: 3 }],
            }),
            people('Atelier Sans Page', {
              found: 0,
              noLinkedinPage: true,
              reasons: [{ reason: 'no_people_returned', count: 1 }],
            }),
          ],
        },
      ],
      attention: [],
      recent: page([]),
    };
    renderWith(<ApifyLogWidget refreshKey={0} />, fakeServer({ 'GET /api/apify/log': log }));
    expect(await screen.findByText('Find people: Huilerie Fixture')).toBeInTheDocument();
    expect(
      screen.getByText(
        '3 people found, 0 decision-makers — no decision-makers because: no matching title (3)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '0 people found, 0 decision-makers — no decision-makers because: no LinkedIn company page, no people returned',
      ),
    ).toBeInTheDocument();
  });

  it('shows a stopped run error at the top and explains a step error in plain words', async () => {
    const log: ApifyLog = {
      runs: [
        {
          run: run({
            status: 'stopped_by_cap',
            error: 'Next discover step is estimated at $0.12 but only $0.49 remains under the caps',
          }),
          steps: [step('failed', { error: 'provider status ABORTED' })],
        },
      ],
      attention: [],
      recent: page([]),
    };
    renderWith(<ApifyLogWidget refreshKey={0} />, fakeServer({ 'GET /api/apify/log': log }));
    expect(await screen.findByText(/This run stopped: Next discover step/)).toBeInTheDocument();
    expect(screen.getByText(/Apify stopped this run early/)).toBeInTheDocument();
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
