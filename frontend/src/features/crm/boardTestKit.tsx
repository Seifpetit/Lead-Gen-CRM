import type {
  BoardFilters,
  BoardStage,
  BoardStageKey,
  CrmBoard,
  CrmCard,
  CrmCardPage,
  CrmPipeline,
} from '@lead-gen-crm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { fakeServer, type Handler } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { BoardPage } from './BoardPage.js';

export const DAY = 86_400_000;
export const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
export const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

export const STAGES: Record<CrmPipeline, BoardStage[]> = {
  companies: [
    { key: 'found', name: 'Found', collapsedByDefault: false },
    { key: 'investigating', name: 'Investigating', collapsedByDefault: false },
    {
      key: 'decision_maker_identified',
      name: 'Decision-maker identified',
      collapsedByDefault: false,
    },
    { key: 'noise', name: 'Noise', collapsedByDefault: true },
  ],
  people: [
    { key: 'new', name: 'New', collapsedByDefault: false },
    { key: 'contacted', name: 'Contacted', collapsedByDefault: false },
    { key: 'replied', name: 'Replied', collapsedByDefault: false },
    { key: 'won', name: 'Won', collapsedByDefault: false },
    { key: 'lost', name: 'Lost', collapsedByDefault: false },
    { key: 'opted_out', name: 'Opted out', collapsedByDefault: false },
    { key: 'noise', name: 'Noise', collapsedByDefault: true },
  ],
};

export const SECTORS = [
  { id: 'textile', name: 'Textile' },
  { id: 'olive-oil', name: 'Olive oil' },
];

export function companyCard(over: Partial<CrmCard> & { id: string; name: string }): CrmCard {
  const { name, ...rest } = over;
  return {
    pipeline: 'companies',
    stage: 'found',
    stageEnteredAt: ago(3),
    noiseAt: null,
    purgeAt: null,
    removedFrom: null,
    company: {
      id: `co-${over.id}`,
      name,
      sector: 'textile',
      website: `https://www.${over.id}.example.test/`,
      phone: '+216 74 111 222',
      email: `contact@${over.id}.example.test`,
      imageUrl: null,
      imageSource: null,
    },
    person: null,
    score: 72,
    foundAt: ago(3),
    leadId: null,
    runId: 'run-1',
    ...rest,
  };
}

export function personCard(over: Partial<CrmCard> & { id: string }): CrmCard {
  return {
    pipeline: 'people',
    stage: 'new',
    stageEnteredAt: ago(1),
    noiseAt: null,
    purgeAt: null,
    removedFrom: null,
    company: {
      id: 'co-a',
      name: 'Alpha SARL',
      sector: 'textile',
      website: null,
      phone: null,
      email: null,
      imageUrl: null,
      imageSource: null,
    },
    person: {
      id: `p-${over.id}`,
      fullName: 'Amel Ben Salah',
      title: 'Responsable logistique',
      email: 'amel@alpha.example.test',
      phone: null,
      linkedinUrl: 'https://www.linkedin.com/in/amel',
      photoUrl: null,
    },
    score: null,
    foundAt: ago(1),
    leadId: null,
    runId: 'run-1',
    ...over,
  };
}

const textOf = (c: CrmCard) =>
  [c.company.name, c.company.website, c.person?.fullName, c.person?.title].join(' ').toLowerCase();

/** The server's sort, as far as the tests need it. */
function sorted(cards: CrmCard[], filters: BoardFilters): CrmCard[] {
  const order = new Map(cards.map((c, i) => [c.id, i]));
  const name = (c: CrmCard) => (c.person?.fullName ?? c.company.name).toLowerCase();
  const out = [...cards];
  const sort = filters.sort ?? 'score';
  out.sort((a, b) => {
    const by =
      sort === 'score'
        ? (b.score ?? -1) - (a.score ?? -1)
        : sort === 'name'
          ? name(a).localeCompare(name(b))
          : sort === 'sector'
            ? (a.company.sector ?? '').localeCompare(b.company.sector ?? '')
            : sort === 'days'
              ? Date.parse(a.stageEnteredAt) - Date.parse(b.stageEnteredAt)
              : order.get(b.id)! - order.get(a.id)!;
    return by || order.get(a.id)! - order.get(b.id)!;
  });
  return filters.dir && filters.dir !== (sort === 'score' || sort === 'newest' ? 'desc' : 'asc')
    ? out.reverse()
    : out;
}

/**
 * A server that keeps one board in memory and applies the same rules as the real one: filters,
 * sort, per-column pages with a cursor, and the move, remove and restore calls.
 */
export function boardServer(
  pipeline: CrmPipeline,
  initial: CrmCard[],
  options: {
    reject?: (req: { stage?: string }) => unknown;
    route?: string;
    extra?: Record<string, Handler>;
  } = {},
) {
  const cards = new Map(initial.map((c) => [c.id, c]));
  const filtersOf = (q: URLSearchParams): BoardFilters => ({
    q: q.get('q') ?? undefined,
    sector: q.get('sector') ?? undefined,
    minScore: q.get('minScore') ? Number(q.get('minScore')) : undefined,
    sort: (q.get('sort') as BoardFilters['sort']) ?? undefined,
    dir: (q.get('dir') as BoardFilters['dir']) ?? undefined,
  });
  const matching = (f: BoardFilters, stage?: string | null) =>
    sorted(
      [...cards.values()].filter(
        (c) =>
          (!stage || c.stage === stage) &&
          (!f.q || textOf(c).includes(f.q.toLowerCase())) &&
          (!f.sector || c.company.sector === f.sector) &&
          (!f.minScore || (c.score ?? -1) >= f.minScore),
      ),
      f,
    );
  const page = (all: CrmCard[], q: URLSearchParams): CrmCardPage => {
    const from = Number(q.get('cursor') ?? 0);
    const limit = Number(q.get('limit') ?? 50);
    return {
      cards: all.slice(from, from + limit),
      total: all.length,
      nextCursor: from + limit < all.length ? String(from + limit) : null,
    };
  };
  const routes: Record<string, Handler> = {
    [`GET /api/crm/${pipeline}`]: (req): CrmBoard => ({
      pipeline,
      stages: STAGES[pipeline].map((s) => ({
        ...s,
        ...page(matching(filtersOf(req.query), s.key), req.query),
      })),
      sectors: SECTORS,
    }),
    [`GET /api/crm/${pipeline}/cards`]: (req) =>
      page(matching(filtersOf(req.query), req.query.get('stage')), req.query),
    ...options.extra,
  };
  const put = (id: string, next: CrmCard) => {
    cards.set(id, next);
    return next;
  };
  const cardRoutes = (c: CrmCard) => {
    routes[`POST /api/crm/cards/${c.id}/move`] = (req) => {
      const refused = options.reject?.(req.body);
      if (refused) return refused;
      return put(c.id, {
        ...cards.get(c.id)!,
        stage: req.body.stage as BoardStageKey,
        stageEnteredAt: new Date().toISOString(),
      });
    };
    routes[`POST /api/crm/cards/${c.id}/remove`] = () =>
      put(c.id, {
        ...cards.get(c.id)!,
        stage: 'noise',
        noiseAt: new Date().toISOString(),
        purgeAt: inDays(30),
        removedFrom: cards.get(c.id)!.stage,
      });
    routes[`POST /api/crm/cards/${c.id}/restore`] = () =>
      put(c.id, {
        ...cards.get(c.id)!,
        stage: cards.get(c.id)!.removedFrom ?? 'found',
        noiseAt: null,
        purgeAt: null,
        removedFrom: null,
      });
    routes[`POST /api/crm/cards/${c.id}/decision-maker`] = (req) => {
      const company = put(c.id, { ...cards.get(c.id)!, stage: 'decision_maker_identified' });
      return {
        status: 201,
        body: {
          company,
          person: personCard({
            id: 'new-person',
            company: company.company,
            person: {
              id: 'p-new',
              fullName: req.body.fullName,
              title: req.body.title ?? null,
              email: req.body.email ?? null,
              phone: req.body.phone ?? null,
              linkedinUrl: req.body.linkedinUrl ?? null,
              photoUrl: null,
            },
          }),
        },
      };
    };
  };
  initial.forEach(cardRoutes);
  const server = fakeServer(routes);
  renderWith(<BoardPage pipeline={pipeline} />, server, options.route ?? '/');
  return { server, user: userEvent.setup(), cards };
}

export const column = (name: string) => screen.getByRole('region', { name });
export const card = (name: string) => screen.getByRole('group', { name });
export const menu = async (user: ReturnType<typeof userEvent.setup>, name: string, to: string) => {
  await user.click(within(card(name)).getByRole('button', { name: `Move ${name} to` }));
  await user.click(screen.getByRole('button', { name: to }));
};

/** The cards of a column that are drawn right now. */
export const drawn = (name: string) =>
  within(column(name))
    .queryAllByRole('listitem')
    .map((li) => within(li).getByRole('heading', { level: 4 }).textContent);

/** Companies numbered "Company 001" and up, all in the same column. */
export function manyCompanies(count: number, stage: BoardStageKey = 'found'): CrmCard[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return companyCard({ id: `c${n}`, name: `Company ${n}`, stage, score: 1000 - i });
  });
}

/**
 * jsdom has no layout, so give the columns one: side by side, 300px apart, each with a list that
 * starts 48px down. Returns a function that undoes it.
 */
export function layoutColumns(): () => void {
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const section = this.closest('[data-stage]');
    if (this.classList.contains('kanban')) return rect(0, 0, 2400, 800);
    if (section) {
      const at = [...document.querySelectorAll('[data-stage]')].indexOf(section);
      return this.classList.contains('kanban-scroll')
        ? rect(at * 300, 48, 280, 752)
        : this === section
          ? rect(at * 300, 0, 280, 800)
          : rect(0, 0, 0, 0);
    }
    return rect(0, 0, 0, 0);
  });
  return () => spy.mockRestore();
}
