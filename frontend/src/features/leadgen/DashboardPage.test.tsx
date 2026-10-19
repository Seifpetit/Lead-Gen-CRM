import type { CrmCard, CrmFacets } from '@lead-gen-crm/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer, type FakeRequest } from '../../test/fakeServer.js';
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
import { chooseOption } from '../../test/select.js';
import { ago, companyCard, personCard } from '../crm/boardTestKit.js';
import { DashboardPage } from './DashboardPage.js';

const DAY = 86_400_000;
const now = new Date().toISOString();
const fresh = (field: string, at = now) => ({
  field,
  value: 'x',
  kind: 'fact' as const,
  sourceUrl: 'https://maps.example.test/place/1',
  fetchedAt: at,
});

/** The facets the server would count for these cards. */
function facetsOf(cards: CrmCard[]): CrmFacets {
  const count = <K,>(key: (c: CrmCard) => K) => {
    const m = new Map<K, number>();
    for (const c of cards) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
    return m;
  };
  return {
    total: cards.length,
    stages: [...count((c) => c.stage)].map(([key, n]) => ({ key, count: n })),
    sectors: [...count((c) => c.company.sector ?? '')].map(([id, n]) => ({
      id,
      name: id === 'textile' ? 'Textile' : 'Food',
      count: n,
    })),
    runs: [...count((c) => c.runId)].map(([id, n]) => ({ id, count: n })),
  };
}

/** A small stand-in for the card and folder routes of the CRM, with the filters the view sends. */
function crmRoutes(cards: CrmCard[], people: CrmCard[] = []) {
  const pick = (all: CrmCard[], q: URLSearchParams) => {
    const text = q.get('q')?.toLowerCase();
    const stage = q.get('stage');
    const run = q.get('runId');
    const sector = q.get('sector');
    const min = Number(q.get('minScore') ?? 0);
    const days = q.get('foundDays');
    return all.filter(
      (c) =>
        c.stage !== 'noise' &&
        (!stage || c.stage === stage) &&
        (!run || c.runId === run) &&
        (!sector || c.company.sector === sector) &&
        (!text || c.company.name.toLowerCase().includes(text)) &&
        (c.score ?? 0) >= min &&
        (!days || Date.parse(c.foundAt) >= Date.now() - Number(days) * DAY),
    );
  };
  const cardsOf = (all: CrmCard[]) => (req: FakeRequest) => {
    const from = Number(req.query.get('cursor') ?? 0);
    const limit = Number(req.query.get('limit') ?? 50);
    const found = pick(all, req.query);
    return {
      cards: found.slice(from, from + limit),
      total: found.length,
      nextCursor: from + limit < found.length ? String(from + limit) : null,
    };
  };
  const facetsFor = (all: CrmCard[]) => (req: FakeRequest) => {
    req.query.delete('stage');
    return facetsOf(pick(all, req.query));
  };
  return {
    'GET /api/crm/companies/cards': cardsOf(cards),
    'GET /api/crm/companies/facets': facetsFor(cards),
    'GET /api/crm/people/cards': cardsOf(people),
    'GET /api/crm/people/facets': facetsFor(people),
  };
}

const alpha = companyCard({
  id: 'a',
  name: 'Fixture Transport SARL',
  leadId: 'lead-a',
  foundAt: ago(2),
});
const beta = companyCard({
  id: 'b',
  name: 'Second Freight',
  stage: 'investigating',
  score: 40,
  leadId: 'lead-b',
  foundAt: ago(20),
  company: {
    id: 'co-b',
    name: 'Second Freight',
    sector: 'food',
    website: null,
    phone: null,
    email: null,
    imageUrl: null,
    imageSource: null,
    regionId: 'sfax',
    city: null,
    category: null,
    location: null,
  },
});
const amel = personCard({ id: 'm' });

const chartLead = (i: number, daysAgo: number) =>
  lead({
    id: `chart-${i}`,
    company: company({
      id: `cc-${i}`,
      name: `Chart ${i}`,
      sector: i % 2 ? 'food' : 'textile',
      evidence: [fresh('placeId', new Date(Date.now() - daysAgo * DAY).toISOString())],
    }),
    contact: contact({ id: `ct-${i}` }),
  });

const routes = (cards: CrmCard[] = [alpha, beta], extra = {}) => ({
  ...dashboardRoutes(),
  ...crmRoutes(cards, [amel]),
  'GET /api/leads': page([chartLead(0, 0), chartLead(1, 1)]),
  'GET /api/runs': page([run({ createdAt: now })]),
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

function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

async function setup(cards?: CrmCard[], extra = {}) {
  const server = fakeServer(routes(cards, extra));
  const view = renderWith(
    <>
      <DashboardPage />
      <Where />
    </>,
    server,
    '/leadgen',
  );
  const user = userEvent.setup();
  await screen.findByText(cards?.[0]?.company.name ?? 'Fixture Transport SARL');
  return { server, user, ...view };
}
const panel = () => screen.getByRole('region', { name: 'Recent leads' });
type User = ReturnType<typeof userEvent.setup>;
/** The Filters button of the panel (or of the Expand window, with `inside`) and its open panel. */
const openFilters = async (user: User, inside?: HTMLElement) => {
  const scope = inside ?? panel();
  await user.click(within(scope).getByRole('button', { name: /^Filters/ }));
  return screen.getByRole('dialog', { name: 'Filters' });
};
const grid = () => within(panel()).getByRole('list', { name: 'Companies found' });
const tile = (name: string) => within(grid()).getByText(name).closest('li')!;
const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.tile-name')?.textContent);

describe('Dashboard panel', () => {
  it('is one panel: a slim header with a single primary button, then the sections', async () => {
    const { container } = await setup();
    const main = container.querySelector('main.page.dash-page');
    expect(main).not.toBeNull();
    expect(main?.querySelectorAll(':scope > .dash-panel')).toHaveLength(1);
    const header = main!.querySelector('.dp-header')!;
    expect(within(header as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Dashboard',
    );
    // "Create run" is the only primary (coral) button on the page, and there are no date buttons.
    const primary = [...main!.querySelectorAll('.button-primary')];
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Create run');
    expect(screen.queryByRole('radio', { name: 'Last 7 days' })).toBeNull();
    // The leads on top, then the bottom row of three sections.
    expect(main!.querySelectorAll('.dp-bottom > .panel-section')).toHaveLength(3);
  });
});

describe('Recent leads cards', () => {
  it('shows one small card per lead with name, badges and contact icons', async () => {
    await setup();
    const tile = within(grid()).getByText('Fixture Transport SARL').closest('li')!;
    expect(within(tile).getByRole('link', { name: 'Fixture Transport SARL' })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-1/leads/lead-a',
    );
    expect(within(tile).getByText('Found')).toBeVisible();
    expect(within(tile).getByText('Score 72')).toBeVisible();
    // The city and category replace the repeated "found today"; the date is in the tooltip.
    const sub = within(tile).getByText('Sfax · Corporate office');
    expect(sub).toBeVisible();
    expect(sub).toHaveAttribute('title', expect.stringContaining('Found'));
    // The phone is shown in full, the email and website as domains.
    expect(within(tile).getByText('+216 74 111 222')).toBeVisible();
    expect(
      within(tile).getByText('a.example.test', { selector: '.channel-email .channel-text' }),
    ).toBeVisible();
    expect(within(tile).getByRole('link', { name: /Phone/ })).toBeVisible();
    // No phone or website: the icons are there but dimmed and named.
    const bare = within(grid()).getByText('Second Freight').closest('li')!;
    expect(within(bare).getByRole('img', { name: 'No phone number' })).toHaveClass('is-missing');
    expect(within(bare).getByRole('img', { name: 'No website' })).toHaveClass('is-missing');
  });

  it('opens the company page when a card is clicked', async () => {
    const { user } = await setup();
    const tile = within(grid()).getByText('Fixture Transport SARL').closest('li')!;
    await user.click(within(tile).getByText('Sfax · Corporate office'));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/leadgen/runs/run-1/leads/lead-a');
  });

  it('shows the sector icon when the picture fails to load', async () => {
    const withImage = companyCard({
      id: 'img',
      name: 'Pictured Co',
      leadId: 'lead-i',
      company: {
        id: 'co-img',
        name: 'Pictured Co',
        sector: 'textile',
        website: null,
        phone: null,
        email: null,
        imageUrl: 'https://img.example.test/og.jpg',
        imageSource: 'og',
        regionId: 'sfax',
        city: null,
        category: null,
        location: null,
      },
    });
    await setup([withImage]);
    const tile = within(grid()).getByText('Pictured Co').closest('li')!;
    const img = tile.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://img.example.test/og.jpg');
    expect(tile.querySelector('.thumb-tile')).toBeNull();
    // The picture breaks: the sector's icon tile takes its place.
    img.dispatchEvent(new Event('error'));
    await waitFor(() => expect(tile.querySelector('img')).toBeNull());
    const icon = tile.querySelector('.thumb-tile')!;
    expect(icon).toHaveAttribute('data-sector', 'textile');
    expect(icon.querySelector('svg')).not.toBeNull();
  });

  it('switches between Companies and People', async () => {
    const { user, server } = await setup();
    await user.click(within(panel()).getByRole('radio', { name: 'People' }));
    expect(await within(panel()).findByText('Amel Ben Salah')).toBeVisible();
    expect(server.to('GET /api/crm/people/cards').length).toBeGreaterThan(0);
  });

  it('switches from the card grid to the CRM table from the Filters panel', async () => {
    const { user } = await setup();
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: 'Table' }));
    expect(await within(panel()).findByRole('table')).toBeVisible();
    await user.click(within(filters).getByRole('radio', { name: 'Grid' }));
    expect(within(panel()).queryByRole('table')).toBeNull();
  });

  it('makes the cards compact, with a smaller picture and no found date or contact icons', async () => {
    const { user } = await setup();
    const filters = await openFilters(user);
    expect(within(grid()).getByText('+216 74 111 222')).toBeVisible();
    await user.click(within(filters).getByRole('radio', { name: 'Compact' }));
    expect(within(grid()).queryByText('+216 74 111 222')).toBeNull();
    expect(tile('Fixture Transport SARL')).toHaveClass('tile-compact');
    expect(tile('Fixture Transport SARL').querySelector('.thumb')).toHaveStyle({ width: '36px' });
    await user.click(within(filters).getByRole('radio', { name: 'Comfortable' }));
    expect(within(grid()).getByText('+216 74 111 222')).toBeVisible();
  });

  it('searches in the header, and filters by score and Found through the server', async () => {
    const { user, server } = await setup();
    await user.type(within(panel()).getByRole('searchbox', { name: 'Search leads' }), 'second');
    await waitFor(() => expect(names(grid())).toEqual(['Second Freight']));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('q')).toBe('second');
    await user.clear(within(panel()).getByRole('searchbox', { name: 'Search leads' }));
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(names(grid())).toEqual(['Fixture Transport SARL']));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('foundDays')).toBe('7');
    await user.click(within(filters).getByRole('radio', { name: 'All' }));
    fireEvent.change(within(filters).getByRole('slider', { name: 'Minimum score' }), {
      target: { value: '50' },
    });
    await waitFor(() => expect(names(grid())).toEqual(['Fixture Transport SARL']));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('minScore')).toBe('50');
  });

  it('narrows to the chosen region', async () => {
    const { user, server } = await setup();
    await chooseOption(user, await screen.findByLabelText('Region'), 'Sfax');
    await waitFor(() =>
      expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('regionId')).toBe('sfax'),
    );
  });
});

describe('Rearranging cards', () => {
  it('lets a card be dragged to another place, and keeps it there', async () => {
    await setup();
    expect(names(grid())).toEqual(['Fixture Transport SARL', 'Second Freight']);
    expect(tile('Second Freight')).toHaveAttribute('draggable', 'true');
    const data = { setData: () => undefined, effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tile('Second Freight'), { dataTransfer: data });
    expect(tile('Second Freight')).toHaveClass('is-dragging');
    // Over the left half of the first card: it goes before it.
    fireEvent.dragOver(tile('Fixture Transport SARL'), { dataTransfer: data, clientX: 0 });
    expect(names(grid())).toEqual(['Second Freight', 'Fixture Transport SARL']);
    fireEvent.dragEnd(tile('Second Freight'));
    expect(tile('Second Freight')).not.toHaveClass('is-dragging');
    expect(names(grid())).toEqual(['Second Freight', 'Fixture Transport SARL']);
  });

  it('moves a card with Alt and an arrow key, and says where it went', async () => {
    const { user } = await setup();
    within(tile('Fixture Transport SARL'))
      .getByRole('link', { name: 'Fixture Transport SARL' })
      .focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(names(grid())).toEqual(['Second Freight', 'Fixture Transport SARL']);
    expect(
      await screen.findByText('Fixture Transport SARL moved to place 2 of 2.'),
    ).toBeInTheDocument();
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(names(grid())).toEqual(['Fixture Transport SARL', 'Second Freight']);
  });

  it('goes back to the sort order when the sort changes', async () => {
    const { user } = await setup();
    await user.keyboard('{Tab}');
    within(tile('Fixture Transport SARL'))
      .getByRole('link', { name: 'Fixture Transport SARL' })
      .focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(names(grid())).toEqual(['Second Freight', 'Fixture Transport SARL']);
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: 'Name A to Z' }));
    await waitFor(() =>
      expect(names(grid())).toEqual(['Fixture Transport SARL', 'Second Freight']),
    );
  });

  it('describes how to rearrange for people who cannot see the cards', async () => {
    await setup();
    expect(grid()).toHaveAccessibleDescription(
      'Drag a card to rearrange it, or press Alt and an arrow key.',
    );
  });
});

describe('Divider between leads and charts', () => {
  const bar = () => screen.getByRole('separator', { name: 'Resize leads and charts' });

  it('starts at the default share and moves with the keyboard, remembering where it was left', async () => {
    window.localStorage.removeItem('leadgen.dash.split');
    const { user, container } = await setup();
    const panelBox = container.querySelector<HTMLElement>('.dash-panel')!;
    expect(bar()).toHaveAttribute('aria-valuenow', '61');
    expect(panelBox.style.getPropertyValue('--dp-top')).toBe('61');
    bar().focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(bar()).toHaveAttribute('aria-valuenow', '57');
    expect(panelBox.style.getPropertyValue('--dp-top')).toBe('57');
    expect(panelBox.style.getPropertyValue('--dp-bottom')).toBe('43');
    expect(window.localStorage.getItem('leadgen.dash.split')).toBe('57');
    // It sits between the leads and the three charts.
    expect(bar().previousElementSibling).toHaveClass('dp-leads');
    expect(bar().nextElementSibling).toHaveClass('dp-bottom');
    await user.dblClick(bar());
    expect(bar()).toHaveAttribute('aria-valuenow', '61');
  });

  it('opens where it was left last time', async () => {
    window.localStorage.setItem('leadgen.dash.split', '70');
    await setup();
    expect(bar()).toHaveAttribute('aria-valuenow', '70');
    window.localStorage.removeItem('leadgen.dash.split');
  });
});

describe('Filters panel', () => {
  const chips = () => screen.queryByRole('list', { name: 'Active filters' });

  it('has the one-line header: title, Companies / People, search, Filters and Expand', async () => {
    await setup();
    const head = panel().querySelector('.panel-head')!;
    expect(
      within(head as HTMLElement).getByRole('heading', { name: 'Recent leads' }),
    ).toBeVisible();
    expect(within(head as HTMLElement).getByRole('radio', { name: 'Companies' })).toBeVisible();
    expect(
      within(head as HTMLElement).getByRole('searchbox', { name: 'Search leads' }),
    ).toBeVisible();
    expect(within(head as HTMLElement).getByRole('button', { name: 'Filters' })).toBeVisible();
    expect(within(head as HTMLElement).getByRole('button', { name: 'Expand' })).toBeVisible();
    // Nothing else is in the header or in a second row: the rest is in the panel.
    expect(within(head as HTMLElement).queryByRole('radio', { name: '7 days' })).toBeNull();
    expect(within(panel()).queryByRole('group', { name: 'Stage' })).toBeNull();
    expect(chips()).toBeNull();
  });

  it('holds found range, stages with counts, score, sort, view and density', async () => {
    const { user } = await setup();
    const filters = await openFilters(user);
    for (const name of ['Found', 'Stage', 'Sort by', 'View', 'Card density']) {
      expect(within(filters).getByRole('group', { name })).toBeVisible();
    }
    expect(within(filters).getByRole('slider', { name: 'Minimum score' })).toBeVisible();
    expect(within(filters).getByRole('radio', { name: /^All\s*2$/ })).toBeChecked();
    expect(within(filters).getByRole('radio', { name: /^Found\s*1$/ })).toBeVisible();
    expect(within(filters).getByRole('radio', { name: /^Investigating\s*1$/ })).toBeVisible();
    expect(within(filters).getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('filters the cards by stage as soon as one is picked, and All brings them back', async () => {
    const { user, server } = await setup();
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: /^Investigating/ }));
    await waitFor(() => expect(names(grid())).toEqual(['Second Freight']));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('stage')).toBe(
      'investigating',
    );
    await user.click(within(filters).getByRole('radio', { name: /^All\s*\d+$/ }));
    await waitFor(() => expect(names(grid())).toHaveLength(2));
  });

  it('counts the active filters on the button, and the chips come and go with them', async () => {
    const { user } = await setup();
    const button = () => within(panel()).getByRole('button', { name: /^Filters/ });
    expect(button()).toHaveAccessibleName('Filters');
    expect(within(button()).queryByText(/^\d+$/)).toBeNull();
    const filters = await openFilters(user);

    await user.click(within(filters).getByRole('radio', { name: '30 days' }));
    await waitFor(() => expect(button()).toHaveAccessibleName('Filters, 1 active'));
    expect(within(button()).getByText('1')).toBeVisible();
    expect(within(chips()!).getAllByRole('listitem')).toHaveLength(1);
    expect(within(chips()!).getByText('Found: 30 days')).toBeVisible();

    await user.click(within(filters).getByRole('radio', { name: /^Investigating/ }));
    fireEvent.change(within(filters).getByRole('slider', { name: 'Minimum score' }), {
      target: { value: '30' },
    });
    await waitFor(() => expect(button()).toHaveAccessibleName('Filters, 3 active'));
    expect(
      within(chips()!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Found: 30 days', 'Stage: Investigating', 'Score: 30 or more']);

    // A chip's X removes just that filter, and the row goes when the last one is gone.
    await user.click(
      within(chips()!).getByRole('button', { name: 'Remove filter Stage: Investigating' }),
    );
    await waitFor(() => expect(button()).toHaveAccessibleName('Filters, 2 active'));
    expect(within(chips()!).queryByText('Stage: Investigating')).toBeNull();
    await user.click(
      within(chips()!).getByRole('button', { name: 'Remove filter Found: 30 days' }),
    );
    await user.click(within(chips()!).getByRole('button', { name: /^Remove filter Score/ }));
    await waitFor(() => expect(chips()).toBeNull());
    expect(button()).toHaveAccessibleName('Filters');
  });

  it('does not count the search, the sort or the layout as filters', async () => {
    const { user } = await setup();
    await user.type(within(panel()).getByRole('searchbox', { name: 'Search leads' }), 'fix');
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: 'Name A to Z' }));
    await user.click(within(filters).getByRole('radio', { name: 'Compact' }));
    expect(chips()).toBeNull();
    expect(within(panel()).getByRole('button', { name: 'Filters' })).toBeVisible();
  });

  it('Reset clears every filter at once and leaves the sort and layout alone', async () => {
    const { user, server } = await setup();
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: '7 days' }));
    await user.click(within(filters).getByRole('radio', { name: /^Found\s*1$/ }));
    fireEvent.change(within(filters).getByRole('slider', { name: 'Minimum score' }), {
      target: { value: '50' },
    });
    await user.click(within(filters).getByRole('radio', { name: 'Compact' }));
    await waitFor(() =>
      expect(within(panel()).getByRole('button', { name: 'Filters, 3 active' })).toBeVisible(),
    );
    expect(within(chips()!).getAllByRole('listitem')).toHaveLength(3);

    await user.click(within(filters).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(chips()).toBeNull());
    expect(within(panel()).getByRole('button', { name: 'Filters' })).toBeVisible();
    expect(within(filters).getByRole('radio', { name: 'All' })).toBeChecked();
    expect(within(filters).getByRole('radio', { name: /^All\s*2$/ })).toBeChecked();
    expect(within(filters).getByRole('slider', { name: 'Minimum score' })).toHaveValue('0');
    expect(within(filters).getByRole('button', { name: 'Reset' })).toBeDisabled();
    await waitFor(() => expect(names(grid())).toHaveLength(2));
    const last = server.to('GET /api/crm/companies/cards').at(-1)!;
    expect(last.query.get('stage')).toBeNull();
    expect(last.query.get('foundDays')).toBeNull();
    expect(last.query.get('minScore')).toBeNull();
    // The layout choice is not a filter.
    expect(within(filters).getByRole('radio', { name: 'Compact' })).toBeChecked();
  });

  it('closes with Escape and hands the focus back to the button', async () => {
    const { user } = await setup();
    const button = within(panel()).getByRole('button', { name: /^Filters/ });
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    within(screen.getByRole('dialog', { name: 'Filters' }))
      .getByRole('radio', { name: '7 days' })
      .focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('works with the keyboard alone', async () => {
    const { user } = await setup();
    const button = within(panel()).getByRole('button', { name: /^Filters/ });
    button.focus();
    await user.keyboard('{Enter}');
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    within(filters).getByRole('radio', { name: '7 days' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(within(filters).getByRole('radio', { name: '30 days' })).toBeChecked();
    await waitFor(() =>
      expect(within(panel()).getByRole('button', { name: 'Filters, 1 active' })).toBeVisible(),
    );
    const slider = within(filters).getByRole('slider', { name: 'Minimum score' });
    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: '10' } });
    await waitFor(() =>
      expect(within(panel()).getByRole('button', { name: 'Filters, 2 active' })).toBeVisible(),
    );
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
  });

  it('is the same panel in the Expand window, on the same filters; Escape closes only the panel', async () => {
    const { user } = await setup();
    const filters = await openFilters(user);
    await user.click(within(filters).getByRole('radio', { name: /^Investigating/ }));
    await waitFor(() => expect(names(grid())).toEqual(['Second Freight']));
    await user.keyboard('{Escape}');

    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    // The filter chosen in the panel is on in the window, as a chip and in the badge.
    const inChips = await within(dialog).findByRole('list', { name: 'Active filters' });
    expect(within(inChips).getByText('Stage: Investigating')).toBeVisible();
    const inside = await openFilters(user, dialog);
    expect(within(inside).getByRole('radio', { name: /^Investigating/ })).toBeChecked();
    await user.click(within(inside).getByRole('radio', { name: /^All\s*\d+$/ }));
    // Escape closes the Filters panel first, and the window stays.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Recent leads' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Filters' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Recent leads' })).toBeNull();
    // What was changed in the window is kept in the panel.
    expect(chips()).toBeNull();
  });

  it('shows a folder as a chip too, and the chip clears it', async () => {
    const { user } = await setup();
    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    const folders = await within(dialog).findByRole('navigation', { name: 'Folders' });
    await user.click(within(folders).getByRole('button', { name: /^Food\s*1$/ }));
    const inChips = await within(dialog).findByRole('list', { name: 'Active filters' });
    expect(within(inChips).getByText('Sector: Food')).toBeVisible();
    await user.click(within(inChips).getByRole('button', { name: 'Remove filter Sector: Food' }));
    await waitFor(() =>
      expect(within(dialog).queryByRole('list', { name: 'Active filters' })).toBeNull(),
    );
  });

  it('never asks for Noise, so removed leads do not show', async () => {
    const { server } = await setup();
    expect(server.to('GET /api/crm/companies/cards')[0]!.query.get('excludeNoise')).toBe('true');
  });
});

describe('Expand', () => {
  it('opens a large window with the same cards, and closes with Escape or the X', async () => {
    const { user } = await setup();
    const before = names(grid());
    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('modal-full');
    await waitFor(() =>
      expect(names(within(dialog).getByRole('list', { name: 'Companies found' }))).toEqual(before),
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // The focus is back on the control that opened it.
    expect(within(panel()).getByRole('button', { name: 'Expand' })).toHaveFocus();

    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const again = await screen.findByRole('dialog', { name: 'Recent leads' });
    await user.click(within(again).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps Tab inside the window', async () => {
    const { user } = await setup();
    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    await within(dialog).findByText('Second Freight');
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('lists folders by stage, run and sector with counts, and a folder filters the cards', async () => {
    const { user, server } = await setup();
    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    const folders = await within(dialog).findByRole('navigation', { name: 'Folders' });
    expect(within(folders).getByRole('button', { name: /^All\s*2$/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(folders).getByRole('heading', { name: 'By stage' })).toBeVisible();
    expect(within(folders).getByRole('heading', { name: 'By run' })).toBeVisible();
    expect(within(folders).getByRole('heading', { name: 'By sector' })).toBeVisible();
    await user.click(within(folders).getByRole('button', { name: /^Food\s*1$/ }));
    const list = () => within(dialog).getByRole('list', { name: 'Companies found' });
    await waitFor(() => expect(names(list())).toEqual(['Second Freight']));
    expect(server.to('GET /api/crm/companies/cards').at(-1)!.query.get('sector')).toBe('food');
    await user.click(within(folders).getByRole('button', { name: /^All\s*2$/ }));
    await waitFor(() => expect(names(list())).toHaveLength(2));
  });

  it('ticks cards for bulk Move to and Remove', async () => {
    const { user, server } = await setup(undefined, {
      'POST /api/crm/cards/a/move': alpha,
      'POST /api/crm/cards/b/move': beta,
      'POST /api/crm/cards/a/remove': { ...alpha, stage: 'noise' },
      'POST /api/crm/cards/b/remove': { ...beta, stage: 'noise' },
    });
    await user.click(within(panel()).getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent leads' });
    await within(dialog).findByText('Second Freight');
    expect(within(dialog).queryByText('1 selected')).toBeNull();
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Select Fixture Transport SARL' }),
    );
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Second Freight' }));
    expect(within(dialog).getByText('2 selected')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    // Stages that need a form are not offered for a bulk move.
    expect(screen.queryByRole('button', { name: 'Noise' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decision-maker identified' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Investigating' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/a/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/a/move')[0]!.body).toEqual({ stage: 'investigating' });
    expect(server.to('POST /api/crm/cards/b/move')).toHaveLength(1);
    await waitFor(() => expect(within(dialog).queryByText('2 selected')).toBeNull());

    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Second Freight' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/b/remove')).toHaveLength(1));
  });

  it('has no tick boxes in the small panel', async () => {
    await setup();
    expect(within(panel()).queryByRole('checkbox')).toBeNull();
  });
});

describe('Dashboard fills the window', () => {
  it('keeps 100 leads inside the one grid that scrolls; the page itself holds only the panel', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      companyCard({ id: `c${i}`, name: `Company ${i}`, leadId: `l${i}` }),
    );
    const { container } = await setup(many);
    await waitFor(() => expect(within(grid()).getAllByRole('listitem')).toHaveLength(50));

    const main = container.querySelector('main.page.dash-page')!;
    // Nothing around the grid grows with the cards: the page holds the panel, the panel holds the
    // sections, and the grid is the one scroll area of the leads section.
    expect([...main.children].map((c) => c.className)).toEqual(['dash-panel']);
    expect(
      [...main.querySelector('.dash-panel')!.children].map((c) => c.className.split(' ')[0]),
    ).toEqual(expect.arrayContaining(['dp-header', 'panel-section', 'dp-bottom']));
    const scroller = grid().closest('.tile-scroll');
    expect(scroller).not.toBeNull();
    expect(scroller?.closest('.dp-leads')).not.toBeNull();
    // Only the panel is allowed to scroll (on very short windows); the page never does.
    expect(main.classList.contains('page')).toBe(true);
    expect(document.body.scrollHeight).toBeLessThanOrEqual(document.body.clientHeight);
  });

  it('loads the next page of the grid when it is scrolled near the end', async () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      companyCard({ id: `c${i}`, name: `Company ${i}`, leadId: `l${i}` }),
    );
    const { server } = await setup(many);
    await waitFor(() => expect(within(grid()).getAllByRole('listitem')).toHaveLength(50));
    // jsdom has no layout, so every page looks "near the end": the rest arrives at once.
    await waitFor(() => expect(within(grid()).getAllByRole('listitem')).toHaveLength(70));
    expect(server.to('GET /api/crm/companies/cards').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Dashboard empty state', () => {
  it('invites the first run when there are no leads yet', async () => {
    const server = fakeServer(routes([]));
    renderWith(<DashboardPage />, server, '/leadgen');
    const section = await screen.findByRole('region', { name: 'Recent leads' });
    expect(
      await within(section).findByText('No leads yet. Create a run to find your first ones.'),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Create run' }));
    expect(await screen.findByRole('dialog', { name: 'Start a run' })).toBeVisible();
  });
});

describe('Create run', () => {
  it('opens a blocking dialog from the button and cancels cleanly', async () => {
    const { server, user } = await setup();
    const button = screen.getByRole('button', { name: 'Create run' });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Start a run' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Region')).toHaveFocus();
    expect(within(dialog).getByText('Advanced').closest('details')).not.toHaveAttribute('open');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('closes on Escape and gives the focus back to the Create run button', async () => {
    const { user } = await setup();
    const button = screen.getByRole('button', { name: 'Create run' });
    await user.click(button);
    await screen.findByRole('dialog', { name: 'Start a run' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a run' });
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('starts on the region picked in the header, and confirms the new run with a toast', async () => {
    const { server, user } = await setup(undefined, {
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await chooseOption(user, screen.getAllByLabelText('Region')[0]!, 'Sfax');
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a run' });
    await waitFor(() => expect(within(dialog).getByLabelText('Region')).toHaveTextContent('Sfax'));
    const start = within(dialog).getByRole('button', { name: 'Start run, up to $2.00' });
    await waitFor(() => expect(start).toHaveAttribute('aria-disabled', 'false'));
    await user.click(start);
    // The estimate ($3.50) is above the $2.00 cap, so there is one more question.
    await user.click(await within(dialog).findByRole('button', { name: 'Yes, start the run' }));

    expect(await screen.findByText('Run started in Sfax.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.to('POST /api/runs')[0]!.body).toEqual({
      regionId: 'sfax',
      sectorIds: ['textile'],
      budgetCapUsd: 2,
      confirm: true,
    });
  });
});

describe('Dashboard charts', () => {
  const perDay = () => screen.getByRole('region', { name: 'Leads per day' });
  const sector = () => screen.getByRole('region', { name: /by sector$/ });

  it('gives each chart a slim header with its own 7 / 30 / 90 day range', async () => {
    const { user } = await setup();
    expect(
      within(perDay()).getByRole('img', { name: /2 leads found in the last 30 days/ }),
    ).toBeVisible();
    expect(within(sector()).getByText('2 leads in the last 30 days.')).toBeVisible();

    // The two ranges are independent.
    await user.click(within(perDay()).getByRole('radio', { name: '7d' }));
    expect(
      within(perDay()).getByRole('img', { name: /2 leads found in the last 7 days/ }),
    ).toBeVisible();
    expect(within(sector()).getByText('2 leads in the last 30 days.')).toBeVisible();

    await user.click(within(sector()).getByRole('radio', { name: '90d' }));
    expect(within(sector()).getByText('2 leads in the last 90 days.')).toBeVisible();
    expect(within(perDay()).getByRole('img', { name: /in the last 7 days/ })).toBeVisible();

    await user.click(within(perDay()).getByRole('radio', { name: '90d' }));
    expect(within(perDay()).getByRole('img', { name: /in the last 90 days/ })).toBeVisible();
  });

  it('draws bars for 7 days or when most days are empty, and a line otherwise', async () => {
    const spread = Array.from({ length: 24 }, (_, i) => chartLead(i, i));
    const { user } = await setup(undefined, { 'GET /api/leads': page(spread) });
    // 24 of the last 30 days have leads: a line.
    expect(perDay().querySelector('.chart-line')).not.toBeNull();
    expect(perDay().querySelectorAll('.chart-bar')).toHaveLength(0);
    // The last 7 days: bars.
    await user.click(within(perDay()).getByRole('radio', { name: '7d' }));
    expect(perDay().querySelector('.chart-line')).toBeNull();
    expect(perDay().querySelectorAll('.chart-bar')).toHaveLength(7);
    // 24 of 90 days is mostly empty: bars again.
    await user.click(within(perDay()).getByRole('radio', { name: '90d' }));
    expect(perDay().querySelector('.chart-line')).toBeNull();
    expect(perDay().querySelectorAll('.chart-bar')).toHaveLength(90);
  });

  it('keeps grid lines, axis numbers and a one-line summary', async () => {
    await setup();
    expect(perDay().querySelectorAll('.chart-grid').length).toBeGreaterThan(1);
    expect(perDay().querySelectorAll('.chart-axis').length).toBeGreaterThan(1);
    expect(within(perDay()).getByText(/2 leads found in the last 30 days/)).toBeVisible();
  });

  it('switches the sector chart between Leads and Cost', async () => {
    const { user } = await setup();
    await user.click(within(sector()).getByRole('radio', { name: 'Cost' }));
    const cost = screen.getByRole('region', { name: 'Cost by sector' });
    expect(within(cost).getByText(/\$1\.50 spent in total/)).toBeVisible();
    expect(within(cost).getAllByText('$1.50').length).toBeGreaterThan(0);
  });
});

describe('Runs section', () => {
  it('lists compact rows with region, status, spend against the cap and found to leads', async () => {
    await setup();
    const section = screen.getByRole('region', { name: 'Runs' });
    const row = within(section).getByRole('link', { name: 'Open run for Sfax' });
    expect(row).toHaveAttribute('href', '/leadgen/runs/run-1');
    expect(within(row).getByText('Sfax')).toBeVisible();
    expect(within(row).getByText('$3.21 of $10.00')).toBeVisible();
    // 40 new places plus 4 found again from earlier runs: both were found by this run.
    expect(within(row).getByText('44 places found, 6 leads')).toBeVisible();
    expect(row.querySelector('progress')).not.toBeNull();
  });

  describe('live strip', () => {
    const live = (id: string, region: string, sentence: string, over = {}) =>
      run({
        id,
        region,
        status: 'running',
        currentStage: 'discover',
        budgetCapUsd: 2.5,
        spentUsd: 0.48,
        finishedAt: null,
        liveMessage: sentence,
        stageFraction: 0.5,
        ...over,
      });

    it('shows one slim row per active run: the sentence, the progress, the spend and a link', async () => {
      const one = live(
        'run-live',
        'Ben Arous',
        'Searching Google Maps for olive oil companies in Ben Arous...',
      );
      await setup(undefined, { 'GET /api/runs/live': { runs: [one] } });
      const strip = await screen.findByRole('region', { name: 'Runs in progress' });
      const link = within(strip).getByRole('link', { name: /Searching Google Maps for olive oil/ });
      expect(link).toHaveAttribute('href', '/leadgen/runs/run-live');
      expect(within(strip).getByText('Running')).toBeVisible();
      expect(within(strip).getByText('$0.48 of $2.50')).toBeVisible();
      const bar = within(strip).getByRole('progressbar');
      // Half of the first of six checkpoints is 8 percent of the run.
      expect(bar).toHaveAttribute('aria-valuenow', '8');
      expect(bar).toHaveAttribute('aria-valuetext', '8 percent done. Now: Searching Google Maps');
    });

    it('shows two runs side by side in the strip and stops Create run at two', async () => {
      await setup(undefined, {
        'GET /api/runs/live': {
          runs: [
            live('run-a', 'Sfax', 'Looking up the people who work there...'),
            live('run-b', 'Tunis', 'Found 24 companies, checking which ones move goods...'),
          ],
        },
      });
      const strip = await screen.findByRole('region', { name: 'Runs in progress' });
      expect(within(strip).getAllByRole('listitem')).toHaveLength(2);
      expect(within(strip).getAllByRole('progressbar')).toHaveLength(2);
      for (const button of screen.getAllByRole('button', { name: 'Create run' })) {
        expect(button).toBeDisabled();
      }
    });

    it('draws nothing when no run is in progress, so the leads keep the room', async () => {
      await setup();
      await screen.findByRole('region', { name: 'Recent leads' });
      expect(screen.queryByRole('region', { name: 'Runs in progress' })).toBeNull();
      expect(document.querySelector('.live-strip')).toBeNull();
    });

    it('speaks a changed sentence politely, not every change', async () => {
      const one = live(
        'run-live',
        'Sfax',
        'Searching Google Maps for textile companies in Sfax...',
      );
      await setup(undefined, { 'GET /api/runs/live': { runs: [one] } });
      const strip = await screen.findByRole('region', { name: 'Runs in progress' });
      const announcer = strip.querySelector('[aria-live="polite"]')!;
      await waitFor(() =>
        expect(announcer).toHaveTextContent(
          'Sfax: Searching Google Maps for textile companies in Sfax...',
        ),
      );
    });
  });
});
