import type { RunLogLine } from '@lead-gen-crm/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type FakeRequest } from '../../../test/fakeServer.js';
import { run } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { LogModal, ROW_PX } from './LogModal.js';
import { LOG_POLL_MS } from './useRunLog.js';

const line = (id: number, over: Partial<RunLogLine> = {}): RunLogLine => ({
  id,
  at: `2026-10-19T10:03:${String(id % 60).padStart(2, '0')}.000Z`,
  level: 'info',
  message: `line ${id}`,
  technical: false,
  ...over,
});

/** The server's log endpoint over a list that a test can add to. */
function logServer(lines: RunLogLine[], extra: Record<string, never> | object = {}) {
  const server = fakeServer({
    'GET /api/runs/run-1/logs': (req: FakeRequest) => {
      const after = Number(req.query.get('after') ?? 0);
      const limit = Number(req.query.get('limit') ?? 500);
      const rest = lines.filter((l) => l.id > after);
      return { items: rest.slice(0, limit), hasMore: rest.length > limit };
    },
    ...extra,
  });
  return server;
}

// jsdom has no layout: give the log panel a height and a scroll position that can be set.
const scrollTops = new WeakMap<Element, number>();
const originalTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
const originalHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scrollTops.get(this) ?? 0;
    },
    set(v: number) {
      scrollTops.set(this, v);
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return (this as Element).classList.contains('term') ? 200 : 0;
    },
  });
});
afterEach(() => {
  if (originalTop) Object.defineProperty(Element.prototype, 'scrollTop', originalTop);
  if (originalHeight) Object.defineProperty(Element.prototype, 'clientHeight', originalHeight);
});

const going = run({ id: 'run-1', status: 'running', finishedAt: null });
const ended = run({ id: 'run-1', status: 'finished' });

function open(lines: RunLogLine[], r = going, onClose = () => {}) {
  const server = logServer(lines);
  const view = renderWith(<LogModal run={r} onClose={onClose} />, server);
  return { server, lines, ...view };
}
const panel = () => screen.getByRole('log', { name: 'Log lines' });
const rowTexts = () => Array.from(panel().querySelectorAll('.term-msg')).map((m) => m.textContent);

describe('LogModal', () => {
  it('shows every line with its time and level, the technical ones marked, oldest first', async () => {
    open([
      line(1, { message: 'Searching Google Maps for textile companies in Sfax...' }),
      line(2, { message: 'Started: estimated cost $0.40 [discover step]', technical: true }),
      line(3, { level: 'warn', message: 'A search came back empty.' }),
      line(4, { level: 'error', message: 'A lookup failed.' }),
    ]);
    expect(
      await screen.findByText('Searching Google Maps for textile companies in Sfax...'),
    ).toBeVisible();
    expect(rowTexts()).toEqual([
      'Searching Google Maps for textile companies in Sfax...',
      'Started: estimated cost $0.40 [discover step]',
      'A search came back empty.',
      'A lookup failed.',
    ]);
    const rows = panel().querySelectorAll('.term-row');
    expect(rows[0]!.querySelector('.term-time')).toHaveTextContent('10:03:01');
    expect(rows[0]!.querySelector('.term-level')).toHaveTextContent('INFO');
    expect(rows[1]).toHaveAttribute('data-technical', 'true');
    expect(rows[2]).toHaveAttribute('data-level', 'warn');
    expect(rows[3]!.querySelector('.term-level')).toHaveTextContent('ERROR');
    expect(screen.getByRole('dialog', { name: 'All logs: run in Sfax' })).toBeVisible();
  });

  it('reads every page of a long log', async () => {
    const many = Array.from({ length: 1_200 }, (_, i) => line(i + 1));
    open(many);
    await waitFor(() => expect(screen.getByText(/1200 of 1200 lines/)).toBeVisible());
  });

  it('draws only the lines on screen, however long the log is', async () => {
    open(Array.from({ length: 2_000 }, (_, i) => line(i + 1)));
    await waitFor(() => expect(screen.getByText(/2000 of 2000 lines/)).toBeVisible());
    const drawn = panel().querySelectorAll('.term-row').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(100);
  });

  it('starts at the newest line and follows new ones', async () => {
    const { lines } = open(Array.from({ length: 40 }, (_, i) => line(i + 1)));
    await waitFor(() => expect(screen.getByText(/40 of 40 lines/)).toBeVisible());
    expect(panel().scrollTop).toBe(40 * ROW_PX);
    expect(screen.getByText('Following the latest line')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();

    lines.push(line(41), line(42));
    await waitFor(() => expect(screen.getByText(/42 of 42 lines/)).toBeVisible(), {
      timeout: LOG_POLL_MS * 3,
    });
    expect(panel().scrollTop).toBe(42 * ROW_PX);
    expect(rowTexts().at(-1)).toBe('line 42');
  });

  it('pauses when you scroll up, keeps your place as lines arrive, and resumes on Jump to latest', async () => {
    const { lines } = open(Array.from({ length: 40 }, (_, i) => line(i + 1)));
    await waitFor(() => expect(screen.getByText(/40 of 40 lines/)).toBeVisible());

    panel().scrollTop = 100;
    fireEvent.scroll(panel());
    const jump = await screen.findByRole('button', { name: 'Jump to latest' });
    expect(screen.getByText('Paused while you read. New lines keep arriving.')).toBeVisible();

    lines.push(line(41));
    await waitFor(() => expect(screen.getByText(/41 of 41 lines/)).toBeVisible(), {
      timeout: LOG_POLL_MS * 3,
    });
    expect(panel().scrollTop).toBe(100);

    await userEvent.setup().click(jump);
    expect(panel().scrollTop).toBe(41 * ROW_PX);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    expect(screen.getByText('Following the latest line')).toBeVisible();
  });

  it('resumes by itself when you scroll back to the bottom', async () => {
    open(Array.from({ length: 40 }, (_, i) => line(i + 1)));
    await waitFor(() => expect(screen.getByText(/40 of 40 lines/)).toBeVisible());
    panel().scrollTop = 0;
    fireEvent.scroll(panel());
    await screen.findByRole('button', { name: 'Jump to latest' });
    panel().scrollTop = 40 * ROW_PX - 200;
    fireEvent.scroll(panel());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull(),
    );
  });

  it('filters by level and by text', async () => {
    const { container } = open([
      line(1, { message: 'Searching Google Maps' }),
      line(2, { level: 'warn', message: 'A search came back empty.' }),
      line(3, { level: 'error', message: 'A lookup failed.' }),
      line(4, { message: 'Verifying 12 email addresses...' }),
    ]);
    await screen.findByText('Searching Google Maps');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Warnings and errors' }));
    expect(rowTexts()).toEqual(['A search came back empty.', 'A lookup failed.']);
    expect(screen.getByText('2 of 4 lines')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Errors only' }));
    expect(rowTexts()).toEqual(['A lookup failed.']);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the log' }), 'EMAIL');
    expect(rowTexts()).toEqual(['Verifying 12 email addresses...']);
    await user.clear(screen.getByRole('searchbox', { name: 'Search the log' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the log' }), 'nothing like this');
    expect(within(container.ownerDocument.body).getByText('No lines match.')).toBeVisible();
  });

  it('copies the lines shown', async () => {
    open([line(1, { message: 'one' }), line(2, { level: 'warn', message: 'two' })]);
    await screen.findByText('one');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Warnings and errors' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('2026-10-19T10:03:02.000Z WARN  two\n');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('downloads a text file named after the region', async () => {
    const make = vi.fn((_blob: Blob) => 'blob:log');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: make, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toMatch(/^run-log-sfax-\d{8}-\d{4}\.txt$/);
    });
    open([line(1, { message: 'one' })]);
    await screen.findByText('one');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = make.mock.calls[0]![0] as unknown as Blob;
    expect(blob.type).toContain('text/plain');
    click.mockRestore();
  });

  it('says so when the run has ended and the log is complete', async () => {
    open([line(1)], ended);
    await screen.findByText('line 1');
    expect(screen.getByText('This run has ended. The log is complete.')).toBeVisible();
  });

  it('says so when there is nothing yet', async () => {
    open([]);
    expect(await screen.findByText('No log lines yet.')).toBeVisible();
  });

  it('shows a failure to read the log', async () => {
    renderWith(
      <LogModal run={ended} onClose={() => {}} />,
      fakeServer({ 'GET /api/runs/run-1/logs': { status: 500, body: {} } }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
  });

  it('shows what the server sent, which has the secrets taken out', async () => {
    open([line(1, { message: 'Calling the actor with token [hidden]' })]);
    expect(await screen.findByText('Calling the actor with token [hidden]')).toBeVisible();
  });

  it('closes on Escape and hands focus back to the button that opened it', async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOn(true)}>
            Open all logs
          </button>
          {on && <LogModal run={going} onClose={() => setOn(false)} />}
        </>
      );
    }
    const server = logServer([line(1)]);
    renderWith(<Harness />, server);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Open all logs' });
    await user.click(opener);
    await screen.findByText('line 1');
    // Focus is inside the window and stays there when tabbing around.
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
