import { SLOT } from './boardLayout.js';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  boardServer,
  card,
  column,
  companyCard,
  drawn,
  manyCompanies,
  personCard,
} from './boardTestKit.js';

/** jsdom has no layout: say how far a column has been scrolled. */
function scrollTo(name: string, top: number) {
  const scroller = within(column(name)).getByRole('list').parentElement!;
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: top });
  fireEvent.scroll(scroller);
}

const cardsCalls = (server: ReturnType<typeof boardServer>['server']) =>
  server.to('GET /api/crm/companies/cards');

describe('a long column', () => {
  it('shows the true total, loads 50 cards and draws only the ones in view', async () => {
    const { server } = boardServer('companies', manyCompanies(120));
    await screen.findByRole('group', { name: 'Company 001' });
    expect(within(column('Found')).getByLabelText('120 in total')).toHaveTextContent('120');
    const board = server.to('GET /api/crm/companies')[0]!;
    expect(board.query.get('limit')).toBe('50');
    // 50 loaded, a dozen drawn.
    const names = drawn('Found');
    expect(names.length).toBeGreaterThan(5);
    expect(names.length).toBeLessThan(20);
    expect(names[0]).toBe('Company 001');
  });

  it('stays cheap with a thousand cards', async () => {
    boardServer('companies', manyCompanies(1000));
    await screen.findByRole('group', { name: 'Company 001' });
    expect(within(column('Found')).getByLabelText('1000 in total')).toBeInTheDocument();
    expect(drawn('Found').length).toBeLessThan(20);
    expect(document.querySelectorAll('.kanban-card').length).toBeLessThan(20);
  });

  it('loads the next 50 near the bottom, once, and shows the cards that follow', async () => {
    const { server } = boardServer('companies', manyCompanies(120));
    await screen.findByRole('group', { name: 'Company 001' });
    expect(cardsCalls(server)).toHaveLength(0);

    scrollTo('Found', 46 * SLOT);
    await waitFor(() => expect(cardsCalls(server)).toHaveLength(1));
    const first = cardsCalls(server)[0]!;
    expect(first.query.get('stage')).toBe('found');
    expect(first.query.get('cursor')).toBe('50');
    expect(first.query.get('limit')).toBe('50');

    // The new page is drawn when scrolled to; a repeat scroll does not ask twice.
    scrollTo('Found', 51 * SLOT);
    expect(await screen.findByRole('group', { name: 'Company 055' })).toBeInTheDocument();
    expect(cardsCalls(server)).toHaveLength(1);

    // And the page after that, which is the last: the cursor runs out.
    scrollTo('Found', 98 * SLOT);
    await waitFor(() => expect(cardsCalls(server)).toHaveLength(2));
    expect(cardsCalls(server)[1]!.query.get('cursor')).toBe('100');
    scrollTo('Found', 119 * SLOT);
    expect(await screen.findByRole('group', { name: 'Company 120' })).toBeInTheDocument();
    scrollTo('Found', 119 * SLOT);
    expect(cardsCalls(server)).toHaveLength(2);
    expect(within(column('Found')).getByLabelText('120 in total')).toBeInTheDocument();
  });

  it('does not repeat a card that was moved into the column before its page arrived', async () => {
    const cards = [
      ...manyCompanies(60),
      companyCard({ id: 'x', name: 'Moved in', stage: 'investigating', score: 5 }),
    ];
    const { server, user } = boardServer('companies', cards);
    await screen.findByRole('group', { name: 'Company 001' });
    await user.click(
      within(card('Company 001')).getByRole('button', { name: 'Move Company 001 to' }),
    );
    await user.click(screen.getByRole('button', { name: 'Investigating' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/c001/move')).toHaveLength(1));
    expect(within(column('Investigating')).getByLabelText('2 in total')).toBeInTheDocument();
    expect(within(column('Found')).getByLabelText('59 in total')).toBeInTheDocument();
  });
});

describe('the toolbar', () => {
  const sample = () => [
    companyCard({ id: 'alpha', name: 'Alpha Textile', score: 90 }),
    {
      ...companyCard({ id: 'beta', name: 'Beta Oil', score: 40 }),
      company: {
        ...companyCard({ id: 'beta', name: 'Beta Oil' }).company,
        sector: 'olive-oil',
      },
    },
    companyCard({ id: 'gamma', name: 'Gamma Cotton', score: 65 }),
  ];

  it('sends the search to the server, and the column totals follow', async () => {
    const { server, user } = boardServer('companies', sample());
    await screen.findByRole('group', { name: 'Alpha Textile' });
    expect(within(column('Found')).getByLabelText('3 in total')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search the board' }), 'beta');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Alpha Textile' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('group', { name: 'Beta Oil' })).toBeInTheDocument();
    expect(within(column('Found')).getByLabelText('1 in total')).toBeInTheDocument();
    const last = server.to('GET /api/crm/companies').at(-1)!;
    expect(last.query.get('q')).toBe('beta');
    // One request for the finished word, not one per key.
    expect(server.to('GET /api/crm/companies').filter((c) => c.query.get('q'))).toHaveLength(1);
  });

  it('sends sector, minimum score and sort to the server, from the Filters panel', async () => {
    const { server, user } = boardServer('companies', sample());
    await screen.findByRole('group', { name: 'Alpha Textile' });
    const board = () => server.to('GET /api/crm/companies').at(-1)!;
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });

    await user.click(within(panel).getByRole('radio', { name: 'Olive oil' }));
    await waitFor(() => expect(board().query.get('sector')).toBe('olive-oil'));
    expect(await screen.findByRole('group', { name: 'Beta Oil' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Alpha Textile' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: 'All sectors' }));

    fireEvent.change(within(panel).getByRole('slider', { name: 'Minimum score' }), {
      target: { value: '70' },
    });
    await waitFor(() => expect(board().query.get('minScore')).toBe('70'));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Gamma Cotton' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('group', { name: 'Alpha Textile' })).toBeInTheDocument();
    fireEvent.change(within(panel).getByRole('slider', { name: 'Minimum score' }), {
      target: { value: '0' },
    });
    await waitFor(() => expect(board().query.get('minScore')).toBeNull());

    await user.click(within(panel).getByRole('radio', { name: 'Name' }));
    await waitFor(() => expect(board().query.get('sort')).toBe('name'));
    await user.click(within(panel).getByRole('radio', { name: 'Descending' }));
    await waitFor(() => expect(board().query.get('dir')).toBe('desc'));
    const order = () => drawn('Found');
    await waitFor(() => expect(order()).toEqual(['Gamma Cotton', 'Beta Oil', 'Alpha Textile']));
  });

  it('shows the filters that are on as chips and counts them on the button', async () => {
    const { user } = boardServer('companies', sample());
    await screen.findByRole('group', { name: 'Alpha Textile' });
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('radio', {
        name: 'Olive oil',
      }),
    );
    const chips = await screen.findByRole('list', { name: 'Active filters' });
    expect(within(chips).getByText('Sector: Olive oil')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeVisible();
    await user.click(
      within(chips).getByRole('button', { name: 'Remove filter Sector: Olive oil' }),
    );
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull());
  });

  it('says so, and offers to clear the filters, when nothing matches', async () => {
    const { user } = boardServer('companies', sample());
    await screen.findByRole('group', { name: 'Alpha Textile' });
    await user.type(screen.getByRole('searchbox', { name: 'Search the board' }), 'zzz');
    expect(await screen.findByText(/Nothing matches these filters/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('group', { name: 'Alpha Textile' })).toBeInTheDocument();
  });

  it('has no sector filter on the People board', async () => {
    boardServer('people', [personCard({ id: '1' })]);
    await screen.findByRole('group', { name: 'Amel Ben Salah' });
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(panel).queryByRole('group', { name: 'Sector' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('slider', { name: 'Minimum score' })).toBeVisible();
  });
});

describe('the table', () => {
  const sample = () => [
    companyCard({ id: 'alpha', name: 'Alpha Textile', score: 90 }),
    companyCard({ id: 'beta', name: 'Beta Oil', score: 40, stage: 'investigating' }),
    companyCard({ id: 'gamma', name: 'Gamma Cotton', score: 65 }),
    companyCard({
      id: 'delta',
      name: 'Delta Gone',
      score: 10,
      stage: 'noise',
      removedFrom: 'found',
    }),
  ];
  const rows = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[1]!.textContent);

  it('lists the same cards as the board for the same filters', async () => {
    const { user } = boardServer('companies', sample());
    await screen.findByRole('group', { name: 'Alpha Textile' });
    const onBoard = [...drawn('Found'), ...drawn('Investigating')].sort();

    await user.click(screen.getByRole('radio', { name: 'Table' }));
    await screen.findByRole('table');
    await waitFor(() => expect(rows()).toHaveLength(4));
    // Every card on the board is a row; Noise (collapsed on the board) is a row too.
    expect(
      rows()
        .filter((n) => onBoard.includes(n!))
        .sort(),
    ).toEqual(onBoard);
    expect(rows()).toContain('Delta Gone');

    // The same filter narrows both.
    await user.type(screen.getByRole('searchbox', { name: 'Search the board' }), 'gamma');
    await waitFor(() => expect(rows()).toEqual(['Gamma Cotton']));
    await user.click(screen.getByRole('radio', { name: 'Board' }));
    expect(await screen.findByRole('group', { name: 'Gamma Cotton' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Alpha Textile' })).not.toBeInTheDocument();
  });

  it('keeps the view and filters in the address', async () => {
    boardServer('companies', sample(), { route: '/crm/companies?view=table&q=beta' });
    await screen.findByRole('table');
    await waitFor(() => expect(rows()).toEqual(['Beta Oil']));
    expect(screen.getByRole('searchbox', { name: 'Search the board' })).toHaveValue('beta');
  });

  it('sorts by a column on the server, and flips it on a second click', async () => {
    const { server, user } = boardServer('companies', sample(), { route: '/?view=table' });
    await screen.findByRole('table');
    await waitFor(() => expect(rows()).toHaveLength(4));
    // Score is the default sort, highest first.
    expect(rows()[0]).toBe('Alpha Textile');
    await user.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() =>
      expect(rows()).toEqual(['Alpha Textile', 'Beta Oil', 'Delta Gone', 'Gamma Cotton']),
    );
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('sort')).toBe('name');
    await user.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(rows()[0]).toBe('Gamma Cotton'));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('dir')).toBe('desc');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('moves and removes the chosen rows in one go', async () => {
    const { server, user } = boardServer('companies', sample(), { route: '/?view=table' });
    await screen.findByRole('table');
    await waitFor(() => expect(rows()).toHaveLength(4));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha Textile' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Gamma Cotton' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to' }));
    // The stage that needs a form is not offered here.
    const items = within(screen.getByRole('list', { name: 'Move to' })).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Found', 'Investigating']);
    await user.click(screen.getByRole('button', { name: 'Investigating' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/gamma/move')[0]!.body).toEqual({
      stage: 'investigating',
    });
    expect(await screen.findByText('2 moved to Investigating.')).toBeInTheDocument();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select Beta Oil' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/beta/remove')).toHaveLength(1));
    expect(await screen.findByText('1 moved to Noise.')).toBeInTheDocument();
  });

  it('pages the table like a column', async () => {
    const { server } = boardServer('companies', manyCompanies(120), { route: '/?view=table' });
    await screen.findByRole('table');
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const body = document.querySelector('.grid-table-body')!;
    Object.defineProperty(body, 'scrollTop', { configurable: true, writable: true, value: 2200 });
    fireEvent.scroll(body);
    await waitFor(() =>
      expect(
        server.to('GET /api/crm/companies/cards').some((c) => c.query.get('cursor') === '50'),
      ).toBe(true),
    );
  });
});

describe('opening a card', () => {
  it('opens its details on a click and closes them again', async () => {
    const { user } = boardServer('companies', [
      companyCard({ id: 'alpha', name: 'Alpha Textile' }),
    ]);
    await user.click(await screen.findByRole('group', { name: 'Alpha Textile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alpha Textile' });
    expect(within(dialog).getByText('Textile')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '+216 74 111 222' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on Enter from the keyboard', async () => {
    const { user } = boardServer('companies', [
      companyCard({ id: 'alpha', name: 'Alpha Textile' }),
    ]);
    (await screen.findByRole('group', { name: 'Alpha Textile' })).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Alpha Textile' })).toBeInTheDocument();
  });

  it('does not open from its icons or its menu', async () => {
    const { user } = boardServer('companies', [
      companyCard({ id: 'alpha', name: 'Alpha Textile' }),
    ]);
    await screen.findByRole('group', { name: 'Alpha Textile' });
    await user.click(
      within(card('Alpha Textile')).getByRole('button', { name: 'Move Alpha Textile to' }),
    );
    await user.click(screen.getByRole('button', { name: 'Investigating' }));
    expect(screen.queryByRole('dialog', { name: 'Alpha Textile' })).not.toBeInTheDocument();
  });
});
