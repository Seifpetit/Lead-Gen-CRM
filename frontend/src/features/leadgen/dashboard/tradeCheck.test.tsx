import type { TradeCheckPreview, TradeCheckStatus } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, type FakeRequest } from '../../../test/fakeServer.js';
import { dashboardRoutes, page } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { ago, companyCard } from '../../crm/boardTestKit.js';
import { DashboardPage } from '../DashboardPage.js';

const PREVIEW: TradeCheckPreview = {
  unchecked: 12,
  willCheck: 12,
  estimatedCostUsd: 0.0144,
  capUsd: 0.5,
  classifierConfigured: true,
};
const IDLE: TradeCheckStatus = {
  state: 'idle',
  total: 0,
  done: 0,
  yes: 0,
  noise: 0,
  unclear: 0,
  spentUsd: 0,
  capUsd: 0.5,
  message: null,
};

function setup(preview: TradeCheckPreview = PREVIEW, extra: Record<string, unknown> = {}) {
  const cards = [
    companyCard({ id: 'a', name: 'Huilerie Export', foundAt: ago(2) }),
    {
      ...companyCard({ id: 'b', name: 'Dattes du Sud', foundAt: ago(2) }),
    },
  ];
  cards[0]!.company.tradeRole = 'exporter';
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/leads': page([]),
    'GET /api/crm/people/cards': { cards: [], total: 0, nextCursor: null },
    'GET /api/crm/companies/cards': { cards, total: 2, nextCursor: null },
    'GET /api/crm/companies/facets': {
      total: 2,
      stages: [],
      sectors: [],
      runs: [],
      noiseRetentionDays: 30,
    },
    'GET /api/trade-check/preview': preview,
    'GET /api/trade-check': IDLE,
    ...extra,
  });
  renderWith(<DashboardPage />, server, '/leadgen');
  return { server, user: userEvent.setup() };
}

describe('Import/export on the Recent leads', () => {
  it('shows the trade label on a lead that has one, in plain words', async () => {
    setup();
    const tile = (await screen.findByText('Huilerie Export')).closest('li')!;
    expect(within(tile).getByText('Exportateur')).toBeVisible();
    const other = screen.getByText('Dattes du Sud').closest('li')!;
    expect(within(other).queryByText('Exportateur')).toBeNull();
  });

  it('filters by Import/export, defaulting to Yes and not checked, sent to the server', async () => {
    const { server, user } = setup();
    await screen.findByText('Huilerie Export');
    // The default asks the server for nothing special (its own default is yes + not checked).
    expect(server.to('GET /api/crm/companies/cards')[0]!.query.get('trade')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(await screen.findByRole('radio', { name: 'Not checked' }));
    await waitFor(() =>
      expect(
        server.to('GET /api/crm/companies/cards').some((c) => c.query.get('trade') === 'unchecked'),
      ).toBe(true),
    );
    expect(await screen.findByText('Import/export: Not checked')).toBeVisible();
  });
});

describe('Check old leads for import/export', () => {
  it('tells how many older leads were never checked and offers the check', async () => {
    setup();
    expect(
      await screen.findByText('12 older leads were never checked for import/export.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check old leads for import/export' })).toBeVisible();
  });

  it('shows nothing when everything was checked', async () => {
    setup({ ...PREVIEW, unchecked: 0, willCheck: 0, estimatedCostUsd: 0 });
    await screen.findByText('Huilerie Export');
    expect(screen.queryByRole('button', { name: 'Check old leads for import/export' })).toBeNull();
  });

  it('spends nothing until the confirm click, and says what it costs first', async () => {
    const { server, user } = setup();
    await user.click(
      await screen.findByRole('button', { name: 'Check old leads for import/export' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Check old leads for import/export' });
    expect(await within(dialog).findByText(/12 leads have not been checked yet/)).toBeVisible();
    expect(within(dialog).getByText(/Estimated cost: up to \$0\.01/)).toBeVisible();
    expect(within(dialog).getByText(/No new Google Maps or LinkedIn search/)).toBeVisible();
    expect(within(dialog).getByText(/where you can restore them/)).toBeVisible();
    expect(server.to('POST /api/trade-check')).toHaveLength(0);
  });

  it('starts on the confirm click, shows progress and can be stopped', async () => {
    let status: TradeCheckStatus = IDLE;
    const { server, user } = setup(PREVIEW, {
      'POST /api/trade-check': () => {
        status = {
          ...IDLE,
          state: 'running',
          total: 12,
          done: 3,
          yes: 2,
          noise: 1,
          spentUsd: 0.003,
        };
        return status;
      },
      'GET /api/trade-check': () => status,
      'POST /api/trade-check/stop': (_req: FakeRequest) => {
        status = {
          ...status,
          state: 'stopped',
          message: 'Stopped. Nothing already checked is undone.',
        };
        return status;
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Check old leads for import/export' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Check old leads for import/export' });
    await user.click(await within(dialog).findByRole('button', { name: /^Check them, up to/ }));
    expect(await within(dialog).findByText('3 of 12 checked.')).toBeVisible();
    expect(
      within(dialog).getByText(/2 import or export, 1 moved to Noise, 0 unclear/),
    ).toBeVisible();
    expect(server.to('POST /api/trade-check')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Stop the check' }));
    expect(
      await within(dialog).findByText(/Stopped\. Nothing already checked is undone/),
    ).toBeVisible();
  });

  it('says so when there is no classifier key, and cannot start', async () => {
    const { user } = setup({
      ...PREVIEW,
      classifierConfigured: false,
      willCheck: 0,
      estimatedCostUsd: 0,
    });
    await user.click(
      await screen.findByRole('button', { name: 'Check old leads for import/export' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Check old leads for import/export' });
    expect(await within(dialog).findByText(/No classifier key is set/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: /^Check them/ })).toBeDisabled();
  });
});
