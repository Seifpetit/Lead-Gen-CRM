import { SLOT } from './boardLayout.js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  boardServer,
  card,
  column,
  companyCard,
  drawn,
  layoutColumns,
  manyCompanies,
} from './boardTestKit.js';

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = layoutColumns();
});
afterEach(() => {
  restoreLayout();
  document.body.classList.remove('is-dragging-card');
});

type Point = { x: number; y: number };
const at = (column: number, row = 0): Point => ({ x: column * 300 + 100, y: 48 + row * SLOT + 10 });

/** A mouse press on a card, then moves; resolves once each step has been drawn. */
async function press(el: Element, from: Point) {
  await act(async () => {
    fireEvent.mouseDown(el, { button: 0, clientX: from.x, clientY: from.y });
  });
}
async function moveTo(to: Point) {
  await act(async () => {
    fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y });
  });
  // The board follows the pointer on the next frame.
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}
async function release(to: Point) {
  await act(async () => {
    fireEvent.mouseUp(document, { clientX: to.x, clientY: to.y });
  });
}

const companies = () => [
  companyCard({ id: 'alpha', name: 'Alpha Textile', score: 90 }),
  companyCard({ id: 'beta', name: 'Beta Oil', score: 80 }),
];

describe('dragging a card', () => {
  it('a click without movement opens the card, and a drag does not', async () => {
    const { server } = boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });

    // Pressed and released in place: nothing is picked up, the click opens the card.
    await press(alpha, at(0));
    await release(at(0));
    fireEvent.click(alpha);
    expect(await screen.findByRole('dialog', { name: 'Alpha Textile' })).toBeInTheDocument();
    expect(document.querySelector('.kanban-card-overlay')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Pressed, moved a long way and dropped in the next column: moved, and no dialog.
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    expect(document.querySelector('.kanban-card-overlay')).not.toBeNull();
    await moveTo(at(1));
    await release(at(1));
    await waitFor(() => expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/alpha/move')[0]!.body).toEqual({
      stage: 'investigating',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open the card from the click that ends a drag', async () => {
    const { server } = boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 30, y: at(0).y + 30 });
    await release({ x: at(0).x + 30, y: at(0).y + 30 });
    // Dropped where it started (same column): the browser still sends a click to the card.
    fireEvent.click(alpha);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(0);
    // A later, separate click opens it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    fireEvent.click(alpha);
    expect(await screen.findByRole('dialog', { name: 'Alpha Textile' })).toBeInTheDocument();
  });

  it('needs more than 5px of movement to pick a card up', async () => {
    boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 5, y: at(0).y });
    expect(document.querySelector('.kanban-card-overlay')).toBeNull();
    await moveTo({ x: at(0).x + 8, y: at(0).y });
    expect(document.querySelector('.kanban-card-overlay')).not.toBeNull();
    await release(at(0));
  });

  it('does not start a drag from a click on the phone, email or website icon', async () => {
    boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    const icons = within(alpha).getAllByRole('link');
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const link of icons) {
      expect(link).toHaveAttribute('draggable', 'false');
      await press(link, at(0));
      await release(at(0));
      fireEvent.click(link);
      expect(document.querySelector('.kanban-card-overlay')).toBeNull();
      // The website first asks in our own panel; closing it leaves the card as it was.
      const asking = screen.queryByRole('dialog', { name: 'Open the website?' });
      if (asking) fireEvent.click(within(asking).getByRole('button', { name: 'Cancel' }));
    }
    // The icons are links, so the click is theirs: it did not open the card.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('lifts the card, leaves a placeholder, highlights the column and opens a gap', async () => {
    const cards = [
      ...companies(),
      companyCard({ id: 'one', name: 'One', stage: 'investigating', score: 5 }),
      companyCard({ id: 'two', name: 'Two', stage: 'investigating', score: 4 }),
    ];
    boardServer('companies', cards);
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    // Over the first slot of the second column: the card below slides down a slot.
    await moveTo({ x: at(1).x, y: 48 + 1 * SLOT + 5 });

    expect(alpha).toHaveClass('is-dragging');
    expect(document.body).toHaveClass('is-dragging-card');
    expect(column('Investigating')).toHaveClass('is-over');
    expect(column('Found')).not.toHaveClass('is-over');
    const slots = [...column('Investigating').querySelectorAll<HTMLElement>('.kanban-slot')];
    expect(slots.map((s) => s.style.transform)).toEqual(['', `translateY(${SLOT}px)`]);
    expect(screen.getByText('Alpha Textile over Investigating, place 2 of 3.')).toBeInTheDocument();

    // Back out of every column: no highlight, no gap.
    await moveTo({ x: 2900, y: 400 });
    expect(column('Investigating')).not.toHaveClass('is-over');
    await release({ x: 2900, y: 400 });
    expect(document.body).not.toHaveClass('is-dragging-card');
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('puts the card where it was dropped in the column, and the server hears only the stage', async () => {
    const cards = [
      ...companies(),
      companyCard({ id: 'one', name: 'One', stage: 'investigating', score: 5 }),
      companyCard({ id: 'two', name: 'Two', stage: 'investigating', score: 4 }),
    ];
    const { server } = boardServer('companies', cards);
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    await moveTo({ x: at(1).x, y: 48 + 1 * SLOT });
    await release({ x: at(1).x, y: 48 + 1 * SLOT });
    expect(drawn('Investigating')).toEqual(['One', 'Alpha Textile', 'Two']);
    expect(within(column('Found')).getByLabelText('1 in total')).toBeInTheDocument();
    expect(within(column('Investigating')).getByLabelText('3 in total')).toBeInTheDocument();
    await waitFor(() => expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/alpha/move')[0]!.body).toEqual({
      stage: 'investigating',
    });
  });

  it('Escape puts the card back and sends nothing', async () => {
    const { server } = boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    await moveTo(at(1));
    expect(column('Investigating')).toHaveClass('is-over');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });
    expect(document.querySelector('.kanban-card-overlay')).toBeNull();
    expect(document.body).not.toHaveClass('is-dragging-card');
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
    expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(0);
  });

  it('drops into a column that is only partly loaded', async () => {
    const cards = [
      companyCard({ id: 'alpha', name: 'Alpha Textile', score: 2000 }),
      ...manyCompanies(120, 'investigating'),
    ];
    const { server } = boardServer('companies', cards);
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    // 50 of 120 are loaded in Investigating.
    expect(within(column('Investigating')).getByLabelText('120 in total')).toBeInTheDocument();
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    await moveTo({ x: at(1).x, y: 48 + 2 * SLOT });
    await release({ x: at(1).x, y: 48 + 2 * SLOT });

    expect(drawn('Investigating').slice(0, 4)).toEqual([
      'Company 001',
      'Company 002',
      'Alpha Textile',
      'Company 003',
    ]);
    expect(within(column('Investigating')).getByLabelText('121 in total')).toBeInTheDocument();
    await waitFor(() => expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(1));
    // The rest of the column still loads, and the moved card is not repeated in it.
    const list = within(column('Investigating')).getByRole('list').parentElement!;
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 4800 });
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(
        server
          .to('GET /api/crm/companies/cards')
          .some((c) => c.query.get('stage') === 'investigating' && c.query.get('cursor') === '50'),
      ).toBe(true),
    );
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });
    fireEvent.scroll(list);
    await waitFor(() => expect(drawn('Investigating')).toContain('Company 001'));
    expect(drawn('Investigating').filter((n) => n === 'Alpha Textile')).toHaveLength(1);
  });

  it('keeps the card on the board when the server refuses the drop', async () => {
    boardServer('companies', companies(), {
      reject: () => ({ status: 409, body: { error: 'decision_maker_required', message: 'x' } }),
    });
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    await moveTo(at(1));
    await release(at(1));
    expect(
      await screen.findByText('Alpha Textile could not be moved: Add the decision-maker first.'),
    ).toBeInTheDocument();
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('opens the decision-maker form for a drop in that column', async () => {
    const { server } = boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    await press(alpha, at(0));
    await moveTo({ x: at(0).x + 20, y: at(0).y });
    await moveTo(at(2));
    await release(at(2));
    expect(
      await screen.findByRole('dialog', { name: 'Who is the decision-maker at Alpha Textile?' }),
    ).toBeInTheDocument();
    expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(0);
  });

  it('cannot pick up a card that has opted out', async () => {
    boardServer('people', [
      {
        ...companyCard({ id: 'x', name: 'x' }),
        pipeline: 'people',
        stage: 'opted_out',
        company: companyCard({ id: 'x', name: 'Alpha SARL' }).company,
        person: {
          id: 'p',
          fullName: 'Amel Ben Salah',
          title: null,
          email: null,
          phone: null,
          linkedinUrl: null,
          photoUrl: null,
        },
      },
    ]);
    const done = await screen.findByRole('group', { name: 'Amel Ben Salah' });
    await press(done, at(5));
    await moveTo({ x: at(5).x + 30, y: at(5).y });
    expect(document.querySelector('.kanban-card-overlay')).toBeNull();
    await release(at(5));
  });
});

describe('dragging with the keyboard', () => {
  it('picks a card up with Space, moves it a column with the arrow keys and drops it with Space', async () => {
    const { server } = boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });
    alpha.focus();
    await act(async () => {
      fireEvent.keyDown(alpha, { key: ' ', code: 'Space' });
    });
    expect(document.querySelector('.kanban-card-overlay')).not.toBeNull();
    // The sensor starts listening for the arrow keys a moment after Space.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' });
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: ' ', code: 'Space' });
    });
    await waitFor(() => expect(server.to('POST /api/crm/cards/alpha/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/alpha/move')[0]!.body).toEqual({
      stage: 'investigating',
    });
    expect(card('Alpha Textile')).toBeInTheDocument();
  });
});

describe('dragging with a finger', () => {
  const touch = (p: Point) => ({ touches: [{ clientX: p.x, clientY: p.y, identifier: 1 }] });

  it('picks a card up after a short press, but a finger that moves at once is scrolling', async () => {
    boardServer('companies', companies());
    const alpha = await screen.findByRole('group', { name: 'Alpha Textile' });

    // Moves straight away: the column scrolls, no card is picked up.
    await act(async () => {
      fireEvent.touchStart(alpha, touch(at(0)));
    });
    await act(async () => {
      fireEvent.touchMove(alpha, touch({ x: at(0).x, y: at(0).y + 40 }));
      await new Promise((r) => setTimeout(r, 200));
    });
    await act(async () => {
      fireEvent.touchEnd(alpha);
    });
    expect(document.querySelector('.kanban-card-overlay')).toBeNull();

    // Holds for 150ms: picked up.
    await act(async () => {
      fireEvent.touchStart(alpha, touch(at(0)));
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(document.querySelector('.kanban-card-overlay')).not.toBeNull();
    await act(async () => {
      fireEvent.touchEnd(alpha);
    });
  });
});
