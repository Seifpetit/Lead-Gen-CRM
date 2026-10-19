import type { ApifyLog, ApifyLogRun, ApifyStepView } from '@lead-gen-crm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../../test/fakeServer.js';
import { emptyApifyLog, funnel, page, run } from '../../../test/fixtures.js';
import { chooseOption } from '../../../test/select.js';
import { renderWith } from '../../../test/render.js';
import { LogsPage } from './LogsPage.js';

const step = (n: number, over: Partial<ApifyStepView> = {}): ApifyStepView => ({
  runStepId: `s${n}`,
  stage: 'discover',
  stepKey: `discover:r0c${n}`,
  actorId: 'actor',
  apifyRunId: `ap${n}`,
  apifyStatus: null,
  latestState: 'finished',
  history: [],
  target: { query: 'huilerie', cell: `r0c${n}`, company: null },
  summary: null,
  costUsd: 0.01,
  durationSeconds: 10,
  error: null,
  ...over,
});

const bizerte: ApifyLogRun = {
  run: run({
    id: 'run-biz',
    region: 'bizerte',
    createdAt: '2026-10-19T09:00:00.000Z',
    finishedAt: '2026-10-19T09:30:00.000Z',
    spentUsd: 0.553,
    budgetCapUsd: 2,
    placesDroppedOutside: 98,
    funnel: funnel({
      discovered: 0,
      skipped: 0,
      qualified: 0,
      review: 0,
      unreachable: 0,
      peopleFound: 0,
      leads: 0,
    }),
  }),
  steps: [
    step(1, {
      summary: { dropped: [{ reason: 'outside_region', count: 98 }] } as ApifyStepView['summary'],
    }),
    step(2),
  ],
};
const sfax: ApifyLogRun = {
  run: run({ id: 'run-sfax', createdAt: '2026-10-18T09:00:00.000Z' }),
  steps: [],
};
const failed: ApifyLogRun = {
  run: run({
    id: 'run-bad',
    region: 'gabes',
    status: 'failed',
    error: 'Provider said no',
    createdAt: '2026-10-17T09:00:00.000Z',
  }),
  steps: [],
};

const serverWith = (runs: ApifyLogRun[]) =>
  fakeServer({
    'GET /api/apify/log': (): ApifyLog => ({ ...emptyApifyLog(), runs }),
    'GET /api/runs/run-biz/logs': {
      items: [
        {
          id: 1,
          at: '2026-10-19T09:00:01.000Z',
          level: 'info',
          message: 'Starting',
          technical: false,
        },
      ],
      hasMore: false,
    },
    'GET /api/runs/run-sfax/logs': page([]),
  });

const rows = () =>
  within(screen.getByRole('list', { name: 'Runs, newest first' })).getAllByRole('listitem');

describe('Logs page', () => {
  it('lists one compact row per run, newest first, with its outcome, summary and spend', async () => {
    renderWith(<LogsPage />, serverWith([sfax, failed, bizerte]));
    expect(await screen.findByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
    await screen.findByText('Bizerte, 19 Oct');
    const [first, second, third] = rows();
    expect(within(first!).getByText('Bizerte, 19 Oct')).toBeVisible();
    expect(within(first!).getByText('Ended, no results')).toBeVisible();
    expect(
      within(first!).getByText('2 searches, 98 places found, none inside Bizerte'),
    ).toBeVisible();
    expect(within(first!).getByText('$0.553 of $2.00')).toBeVisible();
    expect(within(second!).getByText('Sfax, 18 Oct')).toBeVisible();
    expect(within(second!).getByText('Completed with leads')).toBeVisible();
    expect(within(third!).getByText('Failed')).toBeVisible();
  });

  it('has no repeated Start / Cost checkpoints / End bars', async () => {
    renderWith(<LogsPage />, serverWith([bizerte]));
    await screen.findByText('Bizerte, 19 Oct');
    expect(screen.queryByText('Cost checkpoints')).toBeNull();
  });

  it('filters by status and by region', async () => {
    renderWith(<LogsPage />, serverWith([sfax, failed, bizerte]));
    await screen.findByText('Bizerte, 19 Oct');
    const user = userEvent.setup();

    await chooseOption(user, screen.getByRole('combobox', { name: 'Show runs' }), 'Failed');
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText('Gabes, 17 Oct')).toBeVisible();

    await chooseOption(user, screen.getByRole('combobox', { name: 'Show runs' }), 'All');
    await chooseOption(user, screen.getByRole('combobox', { name: 'Region' }), 'Sfax');
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText('Sfax, 18 Oct')).toBeVisible();

    await chooseOption(user, screen.getByRole('combobox', { name: 'Show runs' }), 'Running');
    expect(await screen.findByText('No runs match')).toBeVisible();
  });

  it('opens the whole log in a window, closes it with Escape and gives focus back', async () => {
    renderWith(<LogsPage />, serverWith([bizerte]));
    const user = userEvent.setup();
    const open = await screen.findByRole('button', { name: 'Open log for Bizerte, 19 Oct' });
    await user.click(open);

    const dialog = await screen.findByRole('dialog', { name: 'Run log: Bizerte, 19 Oct' });
    expect(within(dialog).getByText('The six steps')).toBeVisible();
    expect(within(dialog).getByText('What each step did')).toBeVisible();
    expect(within(dialog).getByText('Costs')).toBeVisible();
    expect(within(dialog).getByText('Dropped places')).toBeVisible();
    expect(within(dialog).getByText('Outside the region')).toBeVisible();
    expect(within(dialog).getByText('Complete log')).toBeVisible();
    expect(await within(dialog).findByText('Starting')).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });

  it('keeps focus inside the window while Tab is pressed', async () => {
    renderWith(<LogsPage />, serverWith([bizerte]));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open log for Bizerte, 19 Oct' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 30; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('has an empty state when there are no runs', async () => {
    renderWith(<LogsPage />, serverWith([]));
    expect(await screen.findByText('No runs to show')).toBeVisible();
  });
});
