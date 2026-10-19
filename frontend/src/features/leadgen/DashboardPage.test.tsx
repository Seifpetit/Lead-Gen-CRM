import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import {
  company,
  contact,
  dashboardRoutes,
  lead,
  page,
  preview,
  run,
} from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { DashboardPage } from './DashboardPage.js';

const now = new Date().toISOString();
const fresh = (field: string, value: string) => ({
  field,
  value,
  kind: 'fact' as const,
  sourceUrl: 'https://maps.example.test/place/1',
  fetchedAt: now,
});

const first = lead({
  id: 'lead-1',
  company: company({
    id: 'co-1',
    name: 'Fixture Transport SARL',
    evidence: [fresh('placeId', 'p1')],
  }),
  contact: contact({ id: 'ct-1', evidence: [fresh('title', 'Responsable logistique')] }),
});
const second = lead({
  id: 'lead-2',
  company: company({
    id: 'co-2',
    name: 'Second Freight',
    sector: 'food',
    phone: '+216 71 111 111',
    evidence: [fresh('placeId', 'p2')],
  }),
  contact: null,
  crmStage: 'confirmed',
  score: { companyFit: 20, contactFit: 0, reachability: 5, total: 25 },
});

const routes = (extra = {}) => ({
  ...dashboardRoutes(),
  'GET /api/leads': page([first, second]),
  'GET /api/coverage': {
    regions: [{ regionId: 'sfax', name: 'Sfax' }],
    sectors: [
      { id: 'textile', name: 'Textile' },
      { id: 'food', name: 'Food' },
    ],
    entries: [
      {
        regionId: 'sfax',
        sectorId: 'textile',
        queriesRun: 3,
        newPlaces: 9,
        leads: 1,
        spendUsd: 1.5,
        costPerLeadUsd: 1.5,
        state: 'yielding',
      },
    ],
  },
  'POST /api/runs/preview': { body: preview() },
  ...extra,
});

async function setup(extra = {}) {
  const server = fakeServer(routes(extra));
  renderWith(<DashboardPage />, server, '/leadgen');
  const user = userEvent.setup();
  await screen.findByText('Fixture Transport SARL');
  return { server, user };
}
const table = () => screen.getByRole('table', { name: 'Recent leads' });

describe('Dashboard leads list', () => {
  it('lists one row per lead with company, website, contact, date, score and a description', async () => {
    await setup();
    const row = within(table()).getByRole('row', { name: /Fixture Transport SARL/ });
    expect(within(row).getByRole('link', { name: 'Fixture Transport SARL' })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-1/leads/lead-1',
    );
    expect(within(row).getByText('fixture-transport.example.test')).toBeVisible();
    expect(
      within(row).getByRole('link', { name: 'amel@fixture-transport.example.test' }),
    ).toBeVisible();
    expect(within(row).getByText(/\d{1,2} \w{3} \d{4}/)).toBeVisible();
    expect(within(row).getByText('77')).toBeVisible();
    expect(within(row).getByText(/Responsable logistique/)).toBeVisible();
    // No person: the company's own number is the fallback.
    const other = within(table()).getByRole('row', { name: /Second Freight/ });
    expect(within(other).getByRole('link', { name: '+216 71 111 111' })).toBeVisible();
    expect(within(other).getByText('Food company in Sfax')).toBeVisible();
  });

  it('shows Bulk actions only once a row is selected', async () => {
    const { user } = await setup();
    expect(screen.queryByRole('button', { name: 'Bulk actions' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Fixture Transport SARL' }));
    expect(screen.getByText('1 selected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Bulk actions' }));
    const menu = screen.getByRole('dialog', { name: 'Bulk actions' });
    expect(within(menu).getByRole('button', { name: 'Confirm' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Dismiss' })).toBeVisible();
    expect(within(menu).getByRole('combobox', { name: 'Move to stage…' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('button', { name: 'Bulk actions' })).toBeNull();
  });

  it('selects every row shown with the header checkbox', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select all leads shown' }));
    expect(screen.getByText('2 selected')).toBeVisible();
  });

  it('confirms the selected leads: the stage changes at once and the server is told', async () => {
    const { server, user } = await setup({
      'PATCH /api/leads/lead-1/stage': { body: { ...first, crmStage: 'confirmed' } },
    });
    await user.click(screen.getByRole('checkbox', { name: 'Select Fixture Transport SARL' }));
    await user.click(screen.getByRole('button', { name: 'Bulk actions' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const row = within(table()).getByRole('row', { name: /Fixture Transport SARL/ });
    await waitFor(() => expect(within(row).getByText('Confirmed')).toBeVisible());
    await waitFor(() => expect(server.to('PATCH /api/leads/lead-1/stage')).toHaveLength(1));
    expect(server.to('PATCH /api/leads/lead-1/stage')[0]!.body).toEqual({ stage: 'confirmed' });
    expect(await screen.findByText('Moved 1 to Confirmed.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Bulk actions' })).toBeNull();
  });

  it('rolls an optimistic move back and says so in a toast when the server fails', async () => {
    const { user } = await setup({
      'PATCH /api/leads/lead-1/stage': { status: 500, body: { error: 'internal' } },
    });
    const row = () => within(table()).getByRole('row', { name: /Fixture Transport SARL/ });
    expect(within(row()).getByText('System suggested')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Select Fixture Transport SARL' }));
    await user.click(screen.getByRole('button', { name: 'Bulk actions' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('1 of 1 could not be moved to Dismissed and were put back.');
    expect(within(row()).getByText('System suggested')).toBeVisible();
  });

  it('shows All, Confirmed and Dismissed as tabs with counts', async () => {
    const { user } = await setup();
    expect(screen.getByRole('tab', { name: /^All\s*2$/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /^Confirmed\s*1$/ }));
    expect(within(table()).queryByText('Fixture Transport SARL')).toBeNull();
    expect(within(table()).getByText('Second Freight')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: /^Dismissed\s*0$/ }));
    expect(screen.getByText('No leads in this view yet.')).toBeVisible();
  });

  it('searches, filters by score and sorts', async () => {
    const { user } = await setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'second');
    expect(within(table()).queryByText('Fixture Transport SARL')).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search leads' }));
    await user.selectOptions(screen.getByLabelText('Score'), '50 or more');
    expect(within(table()).queryByText('Second Freight')).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'zzz');
    expect(screen.getByText('No leads match your search.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Company A to Z');
    const names = within(table())
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('link')[0]!.textContent);
    expect(names[0]).toBe('Fixture Transport SARL');
  });

  it('hides columns and tightens rows from the display settings popover', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Display settings' }));
    await user.click(screen.getByRole('checkbox', { name: 'Score' }));
    expect(within(table()).queryByRole('columnheader', { name: 'Score' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(table()).toHaveClass('density-compact');
  });

  it('narrows to the chosen region', async () => {
    const { server, user } = await setup();
    await screen.findByRole('option', { name: 'Sfax' });
    await user.selectOptions(screen.getAllByLabelText('Region')[0]!, 'Sfax');
    await waitFor(() =>
      expect(server.to('GET /api/leads').some((c) => c.query.get('regionId') === 'sfax')).toBe(
        true,
      ),
    );
  });
});

describe('Dashboard fills the window', () => {
  it('keeps 100 rows inside the one list that scrolls, under a header that stays', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      lead({
        id: `lead-${i}`,
        company: company({
          id: `co-${i}`,
          name: `Company ${i}`,
          evidence: [fresh('placeId', 'p')],
        }),
      }),
    );
    const server = fakeServer(routes({ 'GET /api/leads': page(many) }));
    const { container } = renderWith(<DashboardPage />, server, '/leadgen');
    await screen.findByText('Company 0');
    // Header row plus the 100 leads.
    expect(within(table()).getAllByRole('row')).toHaveLength(101);
    // The list is the card's own scroll area, and nothing around it grows with the rows.
    const scroller = table().closest('.table-scroll');
    expect(scroller).not.toBeNull();
    expect(scroller?.closest('.leads-card')).not.toBeNull();
    expect(scroller?.querySelector('thead')).not.toBeNull();
    const page_ = container.querySelector('main.page.dash.fit');
    expect(page_).not.toBeNull();
    // The page's pieces: header, the leads card, then one fixed row of charts and runs.
    expect([...(page_?.children ?? [])].map((c) => c.className)).toEqual(
      expect.arrayContaining(['dash-top', 'dash-main', 'dash-bottom']),
    );
  });
});

describe('Dashboard empty state', () => {
  it('invites the first run when there are no leads yet', async () => {
    const server = fakeServer(routes({ 'GET /api/leads': page([]) }));
    renderWith(<DashboardPage />, server, '/leadgen');
    const card = await screen.findByRole('region', { name: 'Recent leads' });
    expect(
      await within(card).findByText('No leads yet. Create a run to find your first ones.'),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Create run' }));
    expect(await screen.findByRole('dialog', { name: 'Create run' })).toBeVisible();
  });
});

describe('Create run', () => {
  it('opens a blocking dialog from the button and cancels cleanly', async () => {
    const { server, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create run' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('region', { name: 'Start a run' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('starts on the region picked in the top bar, and confirms the new run with a toast', async () => {
    const { server, user } = await setup({
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await screen.findByRole('option', { name: 'Sfax' });
    await user.selectOptions(screen.getAllByLabelText('Region')[0]!, 'Sfax');
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create run' });
    await waitFor(() => expect(within(dialog).getByLabelText('Region')).toHaveValue('sfax'));
    await user.type(within(dialog).getByLabelText('Spend cap (USD)'), '5');
    const review = within(dialog).getByRole('button', { name: 'Review and start' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    await user.click(await screen.findByRole('button', { name: 'Confirm and start run' }));

    expect(await screen.findByText('Run started in sfax.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.to('POST /api/runs')[0]!.body).toEqual({
      regionId: 'sfax',
      budgetCapUsd: 5,
      confirm: true,
    });
  });
});

describe('Dashboard charts', () => {
  it('labels both charts and shares one date range', async () => {
    const { user } = await setup();
    const perDay = screen.getByRole('region', { name: 'Leads per day' });
    expect(
      within(perDay).getByRole('img', {
        name: /Leads per day\. 2 leads found in the last 30 days/,
      }),
    ).toBeVisible();
    const sector = screen.getByRole('region', { name: 'Leads by sector' });
    expect(within(sector).getByText('2 leads in the last 30 days.')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    expect(within(perDay).getByRole('img', { name: /in the last 7 days/ })).toBeVisible();
    expect(within(sector).getByText('2 leads in the last 7 days.')).toBeVisible();
  });

  it('switches the sector chart between Leads and Cost', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Cost' }));
    const sector = screen.getByRole('region', { name: 'Cost by sector' });
    expect(within(sector).getByText(/\$1\.50 spent in total/)).toBeVisible();
    expect(within(sector).getAllByText('$1.50').length).toBeGreaterThan(0);
  });
});
