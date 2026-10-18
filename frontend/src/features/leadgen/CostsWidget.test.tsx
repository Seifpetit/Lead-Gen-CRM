import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { budget, page } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { CostsWidget } from './CostsWidget.js';

const row = (key: string) => ({
  key,
  openEstimateUsd: 0.5,
  actualUsd: 2.25,
  totalUsd: 2.75,
  entries: 4,
});

describe('Costs widget', () => {
  it('shows spend by month and the remaining monthly cap', async () => {
    const server = fakeServer({
      'GET /api/costs': page([row('2026-10')]),
      'GET /api/costs/budget': budget,
    });
    renderWith(<CostsWidget refreshKey={0} />, server);
    expect(await screen.findByText('$45.00 left of $50.00 in October 2026')).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('October 2026')).toBeInTheDocument();
    expect(within(table).getByText('$2.25')).toBeInTheDocument();
    expect(within(table).getByText('$0.50')).toBeInTheDocument();
    expect(server.to('GET /api/costs')[0]!.query.get('groupBy')).toBe('month');
  });

  it('regroups by run, region and provider', async () => {
    const server = fakeServer({
      'GET /api/costs': (req) =>
        page([row(req.query.get('groupBy') === 'run' ? '12345678-aaaa' : 'apify')]),
      'GET /api/costs/budget': budget,
    });
    renderWith(<CostsWidget refreshKey={0} />, server);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Provider'));
    expect(await screen.findByText('apify')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Run'));
    expect(await screen.findByRole('link', { name: 'Run 12345678' })).toHaveAttribute(
      'href',
      '/leadgen/runs/12345678-aaaa',
    );
    expect(server.to('GET /api/costs').map((c) => c.query.get('groupBy'))).toEqual([
      'month',
      'provider',
      'run',
    ]);
  });

  it('has an empty state', async () => {
    renderWith(
      <CostsWidget refreshKey={0} />,
      fakeServer({
        'GET /api/costs': page([]),
        'GET /api/costs/budget': { ...budget, capUsd: null, remainingUsd: null },
      }),
    );
    expect(await screen.findByText('No spend yet')).toBeInTheDocument();
    expect(screen.getByText(/No monthly cap is set/)).toBeInTheDocument();
  });

  it('sets the monthly cap, and refuses a nonsense value without calling the server', async () => {
    const server = fakeServer({
      'GET /api/costs': page([]),
      'GET /api/costs/budget': budget,
      'PUT /api/costs/budget': { body: { ...budget, capUsd: 80, remainingUsd: 75 } },
    });
    renderWith(<CostsWidget refreshKey={0} />, server);
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Monthly cap (USD)');
    await user.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(await screen.findByText('Enter a cap above zero.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')).toHaveLength(0);
    await user.type(input, '80');
    await user.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(await screen.findByText('Monthly cap updated.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')[0]!.body).toEqual({ capUsd: 80 });
  });
});
