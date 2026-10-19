import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { budget, page } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { CostsPage } from './CostsPage.js';

const row = (key: string) => ({
  key,
  openEstimateUsd: 0.5,
  actualUsd: 2.25,
  totalUsd: 2.75,
  entries: 4,
});

describe('Costs page', () => {
  it('shows spend by month and the remaining monthly cap', async () => {
    const server = fakeServer({
      'GET /api/costs': page([row('2026-10')]),
      'GET /api/costs/budget': budget,
    });
    renderWith(<CostsPage />, server);
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
    renderWith(<CostsPage />, server);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Provider'));
    expect(await screen.findByText('apify')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Run'));
    expect(await screen.findByRole('link', { name: 'Run 12345678' })).toHaveAttribute(
      'href',
      '/leadgen/runs/12345678-aaaa',
    );
    // The first is the strip's own month read.
    expect(server.to('GET /api/costs').map((c) => c.query.get('groupBy'))).toEqual([
      'month',
      'month',
      'provider',
      'run',
    ]);
  });

  it('has an empty state', async () => {
    renderWith(
      <CostsPage />,
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
    renderWith(<CostsPage />, server);
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Monthly cap (USD)');
    await user.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(await screen.findByText('Enter an amount such as 50.00.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')).toHaveLength(0);
    await user.type(input, '80');
    await user.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(await screen.findByText('Monthly cap updated.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')[0]!.body).toEqual({ capUsd: 80 });
  });

  it('shows this month on a thin strip above the table', async () => {
    renderWith(
      <CostsPage />,
      fakeServer({
        'GET /api/costs': page([{ ...row('2026-10'), actualUsd: 1.93, openEstimateUsd: 0 }]),
        'GET /api/costs/budget': { ...budget, capUsd: null, remainingUsd: null },
      }),
    );
    expect(
      await screen.findByText('This month: $1.93 actual, $0.00 pending, cap not set'),
    ).toBeInTheDocument();
  });

  it('names the cap in the strip when one is set', async () => {
    renderWith(
      <CostsPage />,
      fakeServer({ 'GET /api/costs': page([row('2026-10')]), 'GET /api/costs/budget': budget }),
    );
    expect(
      await screen.findByText('This month: $2.25 actual, $0.50 pending, cap $50.00'),
    ).toBeInTheDocument();
  });

  it('validates the monthly cap like a run cap', async () => {
    const server = fakeServer({
      'GET /api/costs': page([]),
      'GET /api/costs/budget': budget,
      'PUT /api/costs/budget': { body: { ...budget, capUsd: 12.5, remainingUsd: 7.5 } },
    });
    renderWith(<CostsPage />, server);
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Monthly cap (USD)');
    const set = screen.getByRole('button', { name: 'Set cap' });

    await user.type(input, '5000000');
    await user.click(set);
    expect(await screen.findByText('The cap can be at most $10,000.00.')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '0');
    await user.click(set);
    expect(await screen.findByText('The cap must be at least $1.00.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '12,5');
    await user.click(set);
    expect(await screen.findByText('Monthly cap updated.')).toBeInTheDocument();
    expect(server.to('PUT /api/costs/budget')[0]!.body).toEqual({ capUsd: 12.5 });
  });
});
