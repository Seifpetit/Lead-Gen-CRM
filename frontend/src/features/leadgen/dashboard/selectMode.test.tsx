import {
  PROTECTED_STAGES,
  type CardSelection,
  type CrmCard,
  type CrmFacets,
} from '@lead-gen-crm/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer, type FakeRequest } from '../../../test/fakeServer.js';
import { dashboardRoutes, page } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { ago, companyCard } from '../../crm/boardTestKit.js';
import { DashboardPage } from '../DashboardPage.js';

const RETENTION = 12; // not the usual 30: the dialog must read the server's number

/** The CRM routes as the server behaves: cards, folder counts, selection and the two bulk routes. */
function world(initial: CrmCard[]) {
  const cards = initial.map((c) => ({ ...c }));
  const live = (q: URLSearchParams) =>
    cards.filter(
      (c) =>
        c.stage !== 'noise' &&
        (!q.get('q') || c.company.name.toLowerCase().includes(q.get('q')!.toLowerCase())) &&
        (!q.get('stage') || c.stage === q.get('stage')),
    );
  const facets = (q: URLSearchParams): CrmFacets => ({
    total: live(q).length,
    stages: [],
    sectors: [],
    runs: [],
    noiseRetentionDays: RETENTION,
  });
  const routes = {
    'GET /api/crm/companies/cards': (req: FakeRequest) => {
      const from = Number(req.query.get('cursor') ?? 0);
      const found = live(req.query);
      return {
        cards: found.slice(from, from + 50),
        total: found.length,
        nextCursor: from + 50 < found.length ? String(from + 50) : null,
      };
    },
    'GET /api/crm/companies/facets': (req: FakeRequest) => facets(req.query),
    'GET /api/crm/companies/selection': (req: FakeRequest): CardSelection => {
      const found = live(req.query);
      return {
        total: found.length,
        truncated: false,
        cards: found.map((c) => ({ id: c.id, stage: c.stage })),
      };
    },
    'POST /api/crm/cards/bulk-remove': (req: FakeRequest) => {
      const mine = cards.filter((c) => (req.body.ids as string[]).includes(c.id));
      const moved = mine.filter((c) => c.stage !== 'noise' && !PROTECTED_STAGES.includes(c.stage));
      for (const c of moved) {
        c.removedFrom = c.stage;
        c.stage = 'noise';
      }
      return {
        moved: moved.map((c) => c.id),
        protected: mine.filter((c) => PROTECTED_STAGES.includes(c.stage)).length,
        skipped: 0,
      };
    },
    'POST /api/crm/cards/bulk-restore': (req: FakeRequest) => {
      const back = cards.filter(
        (c) => (req.body.ids as string[]).includes(c.id) && c.stage === 'noise',
      );
      for (const c of back) c.stage = c.removedFrom ?? 'found';
      return { restored: back.length, skipped: 0 };
    },
  };
  return { cards, routes };
}

const many = (n: number, over: Partial<CrmCard> = {}) =>
  Array.from({ length: n }, (_, i) =>
    companyCard({
      id: `id-${i}`,
      name: `Company ${String(i).padStart(3, '0')}`,
      foundAt: ago(2),
      ...over,
    }),
  );

function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

async function setup(initial: CrmCard[]) {
  const w = world(initial);
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/leads': page([]),
    'GET /api/crm/people/cards': { cards: [], total: 0, nextCursor: null },
    ...w.routes,
  });
  const view = renderWith(
    <>
      <DashboardPage />
      <Where />
    </>,
    server,
    '/leadgen',
  );
  const user = userEvent.setup();
  await screen.findByText(initial[0]!.company.name);
  return { ...w, server, user, ...view };
}
const panel = () => screen.getByRole('region', { name: 'Recent leads' });
const grid = () => within(panel()).getByRole('list', { name: 'Companies found' });
const checks = () => within(grid()).queryAllByRole('checkbox');
const selectButton = () => within(panel()).getByRole('button', { name: 'Select' });
const bar = () => screen.getByRole('toolbar', { name: 'Selection' });
const tile = (name: string) => within(grid()).getByText(name).closest('li')!;

describe('Select mode on the lead cards', () => {
  it('has a Select button next to Export, and switches the cards to ticking', async () => {
    const { user } = await setup(many(3));
    expect(checks()).toHaveLength(0);
    const header = selectButton().parentElement!;
    expect(within(header).getByRole('button', { name: /^Export/ })).toBeInTheDocument();

    await user.click(selectButton());
    expect(checks()).toHaveLength(3);
    expect(checks().every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(within(bar()).getByRole('status')).toHaveTextContent('0 selected');
    expect(within(bar()).getByRole('button', { name: 'Move to Noise' })).toBeDisabled();
  });

  it('ticks a card with a click anywhere on it instead of opening it', async () => {
    const { user } = await setup(many(3));
    await user.click(selectButton());
    await user.click(within(tile('Company 001')).getByText('Company 001'));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/leadgen');
    expect(screen.getByRole('checkbox', { name: 'Select Company 001' })).toBeChecked();
    expect(within(bar()).getByRole('status')).toHaveTextContent('1 selected');
    // Again unticks; the checkbox itself works too.
    await user.click(tile('Company 001'));
    expect(within(bar()).getByRole('status')).toHaveTextContent('0 selected');
    await user.click(screen.getByRole('checkbox', { name: 'Select Company 002' }));
    expect(within(bar()).getByRole('status')).toHaveTextContent('1 selected');
    // Cards cannot be dragged around while selecting.
    expect(tile('Company 000')).not.toHaveAttribute('draggable');
  });

  it('is left by Cancel or Escape, which also forget what was ticked', async () => {
    const { user } = await setup(many(3));
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(within(bar()).getByRole('button', { name: 'Cancel' }));
    expect(checks()).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();

    await user.click(selectButton());
    expect(within(bar()).getByRole('status')).toHaveTextContent('0 selected');
    await user.click(tile('Company 000'));
    await user.keyboard('{Escape}');
    expect(checks()).toHaveLength(0);
    await user.click(selectButton());
    expect(within(bar()).getByRole('status')).toHaveTextContent('0 selected');
  });

  it('clears the ticks without leaving the mode', async () => {
    const { user } = await setup(many(3));
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(tile('Company 001'));
    await user.click(within(bar()).getByRole('button', { name: 'Clear' }));
    expect(within(bar()).getByRole('status')).toHaveTextContent('0 selected');
    expect(checks()).toHaveLength(3);
  });

  it('selects every card matching the filters, not only those on screen, and shows the count first', async () => {
    const { user, server } = await setup(many(120));
    expect(within(grid()).getAllByRole('listitem')).toHaveLength(50);
    await user.click(selectButton());
    const all = within(bar()).getByRole('button', { name: 'Select all 120' });
    await user.click(all);
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('120 selected'),
    );
    expect(server.to('GET /api/crm/companies/selection')).toHaveLength(1);

    // With a search, "all" is the cards matching it.
    await user.click(within(bar()).getByRole('button', { name: 'Cancel' }));
    await user.type(within(panel()).getByRole('searchbox'), 'Company 01');
    await waitFor(() => expect(within(grid()).getAllByRole('listitem')).toHaveLength(10));
    await user.click(selectButton());
    await user.click(within(bar()).getByRole('button', { name: 'Select all 10' }));
    await waitFor(() => expect(within(bar()).getByRole('status')).toHaveTextContent('10 selected'));
    const asked = server.to('GET /api/crm/companies/selection').at(-1)!;
    expect(asked.query.get('q')).toBe('Company 01');
    // 120 cards and typing: slow on a busy CI runner, so it gets more than the default 5 s.
  }, 30_000);

  it('asks first, in our own dialog, with the server’s retention days; Cancel moves nothing', async () => {
    const { user, server } = await setup(many(3));
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(tile('Company 001'));
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    const dialog = screen.getByRole('dialog', { name: 'Move 2 leads to Noise?' });
    expect(dialog).toHaveTextContent(`You can restore them from Noise for ${RETENTION} days.`);
    expect(within(dialog).queryByRole('note')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.to('POST /api/crm/cards/bulk-remove')).toHaveLength(0);
    // Escape closes only the dialog; the selection stays.
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(bar()).getByRole('status')).toHaveTextContent('2 selected');
  });

  it('moves them in one request, ends the mode, refreshes the page and offers Undo', async () => {
    const { user, server, cards } = await setup(many(4));
    const leadsBefore = server.to('GET /api/leads').length;
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(tile('Company 002'));
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    await user.click(screen.getByRole('button', { name: 'Move' }));

    const sent = server.to('POST /api/crm/cards/bulk-remove');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.ids.sort()).toEqual(['id-0', 'id-2']);
    expect(server.to('POST /api/crm/cards/id-0/remove')).toHaveLength(0);

    await waitFor(() => expect(screen.queryByText('Company 000')).toBeNull());
    expect(screen.queryByText('Company 002')).toBeNull();
    expect(screen.getByText('Company 001')).toBeInTheDocument();
    expect(checks()).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(await screen.findByText('2 leads moved to Noise.')).toBeInTheDocument();
    // Counters and charts read again.
    await waitFor(() => expect(server.to('GET /api/leads').length).toBeGreaterThan(leadsBefore));
    // Nothing was deleted: the cards are in Noise, with where they came from.
    expect(cards.filter((c) => c.stage === 'noise').map((c) => c.removedFrom)).toEqual([
      'found',
      'found',
    ]);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText('Company 000')).toBeInTheDocument());
    expect(screen.getByText('Company 002')).toBeInTheDocument();
    const undone = server.to('POST /api/crm/cards/bulk-restore');
    expect(undone).toHaveLength(1);
    expect(undone[0]!.body.ids.sort()).toEqual(['id-0', 'id-2']);
    expect(await screen.findByText('2 leads restored.')).toBeInTheDocument();
  });

  it('skips cards the user is already working on, says how many, and says so afterwards', async () => {
    const working = many(2, { stage: 'investigating' }).map((c, i) => ({
      ...c,
      id: `work-${i}`,
      company: { ...c.company, name: `Working ${i}` },
    }));
    const { user, server, cards } = await setup([...many(2), ...working]);
    await user.click(selectButton());
    await user.click(within(bar()).getByRole('button', { name: 'Select all 4' }));
    await waitFor(() => expect(within(bar()).getByRole('status')).toHaveTextContent('4 selected'));
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    const dialog = screen.getByRole('dialog', { name: 'Move 2 leads to Noise?' });
    expect(within(dialog).getByRole('note')).toHaveTextContent(/: 2$/);
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));

    expect(
      await screen.findByText('2 leads moved to Noise. 2 left where they are.'),
    ).toBeInTheDocument();
    const sent = server.to('POST /api/crm/cards/bulk-remove');
    expect(sent[0]!.body.ids.sort()).toEqual(['id-0', 'id-1']);
    expect(cards.filter((c) => c.stage === 'investigating')).toHaveLength(2);
  });

  it('does not offer to move anything when everything ticked is protected', async () => {
    const { user } = await setup(many(2, { stage: 'decision_maker_identified' }));
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    const dialog = screen.getByRole('dialog', { name: 'Move 0 leads to Noise?' });
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled();
  });

  it('sends a big selection in requests of at most 500', async () => {
    const { user, server } = await setup(many(1020));
    await user.click(selectButton());
    await user.click(within(bar()).getByRole('button', { name: 'Select all 1020' }));
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('1020 selected'),
    );
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await screen.findByText('1020 leads moved to Noise.');
    const sizes = server.to('POST /api/crm/cards/bulk-remove').map((c) => c.body.ids.length);
    expect(sizes).toEqual([500, 500, 20]);
  }, 30_000);

  it('reports a failure and keeps the cards', async () => {
    const { user, server, cards } = await setup(many(2));
    server.set('POST /api/crm/cards/bulk-remove', {
      status: 500,
      body: { error: 'internal', message: 'internal' },
    });
    await user.click(selectButton());
    await user.click(tile('Company 000'));
    await user.click(within(bar()).getByRole('button', { name: 'Move to Noise' }));
    await user.click(screen.getByRole('button', { name: 'Move' }));
    expect(await screen.findByText(/Could not move the leads/)).toBeInTheDocument();
    expect(cards.every((c) => c.stage === 'found')).toBe(true);
    expect(screen.getByText('Company 000')).toBeInTheDocument();
  });

  it('is not offered in the table, which has its own ticking', async () => {
    const { user } = await setup(many(2));
    await user.click(within(panel()).getByRole('button', { name: /^Filters/ }));
    await user.click(screen.getByRole('radio', { name: 'Table' }));
    await act(async () => undefined);
    expect(within(panel()).queryByRole('button', { name: 'Select' })).toBeNull();
  });
});
