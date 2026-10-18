import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { funnel, page, run } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { RunsWidget } from './RunsWidget.js';

describe('Runs widget', () => {
  it('shows a clear empty state', async () => {
    renderWith(<RunsWidget refreshKey={0} />, fakeServer({ 'GET /api/runs': page([]) }));
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
  });

  it('shows region, status, funnel counts, spend against the cap and a link', async () => {
    const server = fakeServer({
      'GET /api/runs': page([
        run({
          id: 'r1',
          region: 'sfax',
          funnel: funnel({ discovered: 40, qualified: 12, peopleFound: 9, leads: 6 }),
        }),
        run({
          id: 'r2',
          region: 'tunis',
          status: 'running',
          currentStage: 'find_people',
          spentUsd: 1,
          budgetCapUsd: 4,
        }),
      ]),
    });
    renderWith(<RunsWidget refreshKey={0} />, server);
    const table = await screen.findByRole('table', { name: 'Previous runs' });
    const first = within(table).getByRole('row', { name: /sfax/ });
    expect(within(first).getByText('Finished')).toBeInTheDocument();
    expect(within(first).getByText('Found').nextSibling).toHaveTextContent('40');
    expect(within(first).getByText('Leads').nextSibling).toHaveTextContent('6');
    expect(within(first).getByText('$3.21 of $10.00')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Open run for sfax' })).toHaveAttribute(
      'href',
      '/leadgen/runs/r1',
    );
    const second = within(table).getByRole('row', { name: /tunis/ });
    expect(within(second).getByText('Running')).toBeInTheDocument();
    expect(within(second).getByText('$1.00 of $4.00')).toBeInTheDocument();
  });

  it('shows more runs on request', async () => {
    const server = fakeServer({
      'GET /api/runs': (req) =>
        req.query.get('offset')
          ? page([run({ id: 'r2', region: 'tunis' })], 2, null)
          : page([run({ id: 'r1', region: 'sfax' })], 2, 1),
    });
    renderWith(<RunsWidget refreshKey={0} />, server);
    await screen.findByText('sfax');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('tunis')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    renderWith(
      <RunsWidget refreshKey={0} />,
      fakeServer({ 'GET /api/runs': { status: 500, body: { error: 'internal' } } }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
