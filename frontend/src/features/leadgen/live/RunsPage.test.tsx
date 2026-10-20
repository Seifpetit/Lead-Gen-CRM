import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer, type FakeRequest, type Handler } from '../../../test/fakeServer.js';
import { lastStream, useFakeEventSource } from '../../../test/fakeEventSource.js';
import { company, lead, page, run, runDetail } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { chooseOption } from '../../../test/select.js';
import { RunsPage } from './RunsPage.js';

const going = (id: string, region: string, sentence: string, over = {}) =>
  run({
    id,
    region,
    status: 'running',
    currentStage: 'find_people',
    stageFraction: 0.5,
    budgetCapUsd: 2.5,
    spentUsd: 0.48,
    finishedAt: null,
    liveMessage: sentence,
    ...over,
  });

const sfax = going('run-a', 'Sfax', 'Looking up the people who work there...');
const tunis = going('run-b', 'Tunis', 'Found 24 companies, checking which ones move goods...', {
  currentStage: 'qualify',
});
const old = run({ id: 'run-old', region: 'Sousse', liveMessage: 'Done. 11 leads are ready.' });

function show(routes: Record<string, Handler> = {}, at = '/leadgen/runs?view=live') {
  const server = fakeServer({
    'GET /api/runs/live': { runs: [] },
    'GET /api/runs': page([old]),
    'GET /api/leads': page([]),
    ...routes,
  });
  const view = renderWith(
    <Routes>
      <Route path="/leadgen/runs" element={<RunsPage />} />
      <Route path="/leadgen/runs/:runId" element={<RunsPage />} />
      <Route path="/leadgen" element={<p>Dashboard</p>} />
    </Routes>,
    server,
    at,
  );
  return { server, user: userEvent.setup(), ...view };
}
const leadsOf = (id: string, ...scores: number[]) =>
  scores.map((total, i) =>
    lead({
      id: `${id}-${i}`,
      runId: id,
      company: company({ name: `${id} company ${i}` }),
      score: { companyFit: 1, contactFit: 1, reachability: 1, total },
    }),
  );

describe('Runs page', () => {
  useFakeEventSource();

  it('asks to start a run when none is in progress', async () => {
    show();
    const top = await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [] }));
    expect(await within(top).findByText('No run in progress')).toBeVisible();
    expect(within(top).getByRole('link', { name: 'Go to the Dashboard' })).toHaveAttribute(
      'href',
      '/leadgen',
    );
  });

  it('shows a card for every run in progress, with its sentence, checkpoints, progress and spend', async () => {
    show();
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax, tunis] }));
    const top = screen.getByRole('region', { name: 'Running now' });
    const cardA = within(top).getByRole('region', {
      name: 'Looking up the people who work there...',
    });
    const cardB = within(top).getByRole('region', {
      name: 'Found 24 companies, checking which ones move goods...',
    });
    for (const card of [cardA, cardB]) {
      expect(within(card).getByRole('list', { name: 'Steps of this run' })).toBeVisible();
      expect(within(card).getAllByRole('progressbar')).toHaveLength(2);
      expect(within(card).getByText('$0.48 of $2.50')).toBeVisible();
      expect(within(card).getByRole('button', { name: 'Stop run' })).toBeVisible();
      expect(within(card).getByRole('button', { name: 'Open all logs' })).toBeVisible();
    }
    // Sfax is on its third checkpoint, half way: 2.5 of 6.
    expect(within(cardA).getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '42');
    expect(within(cardA).getByText('Sfax · started 18 Oct 2026, 09:00 UTC')).toBeVisible();
    expect(top.textContent).not.toMatch(/discover|enrich|unreachable/i);
  });

  it('mixes the leads of all active runs, best first, with a switcher for one run', async () => {
    const { server, user } = show({
      'GET /api/leads': (req: FakeRequest) => {
        const id = req.query.get('runId')!;
        const items = id === 'run-a' ? leadsOf('run-a', 90, 40) : leadsOf('run-b', 70);
        return page(items);
      },
    });
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax, tunis] }));
    const results = screen.getByRole('region', { name: 'Results' });
    await within(results).findByText('run-a company 0');
    const text = results.textContent ?? '';
    const at = (name: string) => text.indexOf(name);
    expect(at('run-a company 0')).toBeLessThan(at('run-b company 0'));
    expect(at('run-b company 0')).toBeLessThan(at('run-a company 1'));
    expect(
      server
        .to('GET /api/leads')
        .map((c) => c.query.get('runId'))
        .sort(),
    ).toEqual(['run-a', 'run-b']);

    await chooseOption(user, within(results).getByLabelText('Show leads from'), /Tunis/);
    await waitFor(() => expect(within(results).queryByText('run-a company 0')).toBeNull());
    expect(within(results).getByText('run-b company 0')).toBeVisible();
  });

  it('stops a run after asking', async () => {
    const { server, user } = show({
      'POST /api/runs/run-a/stop': { body: { ...sfax, status: 'cancelled' } },
    });
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax] }));
    const card = screen.getByRole('region', { name: 'Looking up the people who work there...' });
    await user.click(within(card).getByRole('button', { name: 'Stop run' }));
    const dialog = screen.getByRole('dialog', { name: 'Stop this run?' });
    expect(dialog).not.toHaveTextContent(/apify/i);
    expect(server.to('POST /api/runs/run-a/stop')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
    await waitFor(() => expect(server.to('POST /api/runs/run-a/stop')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the log of the run whose button was pressed', async () => {
    const { server, user } = show({
      'GET /api/runs/run-b/logs': { items: [], hasMore: false },
    });
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax, tunis] }));
    const card = screen.getByRole('region', {
      name: 'Found 24 companies, checking which ones move goods...',
    });
    await user.click(within(card).getByRole('button', { name: 'Open all logs' }));
    expect(await screen.findByRole('dialog', { name: 'All logs: run in Tunis' })).toBeVisible();
    expect(server.to('GET /api/runs/run-b/logs').length).toBeGreaterThan(0);
  });

  it('keeps the log window open when its run finishes and moves to the past runs', async () => {
    const { user } = show({
      'GET /api/runs/run-a/logs': { items: [], hasMore: false },
    });
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax] }));
    const card = screen.getByRole('region', { name: 'Looking up the people who work there...' });
    await user.click(within(card).getByRole('button', { name: 'Open all logs' }));
    await screen.findByRole('dialog', { name: 'All logs: run in Sfax' });
    act(() => lastStream().emit('runs', { runs: [] }));
    expect(screen.getByRole('dialog', { name: 'All logs: run in Sfax' })).toBeVisible();
  });

  it('lists the runs that ended under Past runs, in the same card but compact', async () => {
    const { user } = show({
      'GET /api/runs': page([old, sfax]),
      'GET /api/leads': page(leadsOf('run-old', 50)),
    });
    await screen.findByRole('region', { name: 'Running now' });
    act(() => lastStream().emit('runs', { runs: [sfax] }));
    await user.click(await screen.findByRole('tab', { name: /Past runs/ }));
    expect(screen.getByRole('tab', { name: /Past runs/ })).toHaveTextContent('1');
    const card = await screen.findByRole('region', { name: 'Done. 11 leads are ready.' });
    // The active run is not in the past list; the compact card has no progress bars or Stop.
    expect(
      screen.queryAllByRole('region', { name: 'Looking up the people who work there...' }),
    ).toHaveLength(1);
    expect(within(card).queryByRole('progressbar')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Stop run' })).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Show its leads' }));
    expect(await screen.findByText('run-old company 0')).toBeVisible();
  });

  it('opens a finished run at its link: its card first and its leads', async () => {
    show(
      {
        'GET /api/runs/run-old': { body: runDetail({ ...old, leads: [], leadsTotal: 0 }) },
        'GET /api/leads': page(leadsOf('run-old', 50)),
      },
      '/leadgen/runs/run-old',
    );
    const top = await screen.findByRole('region', { name: 'This run' });
    expect(
      await within(top).findByRole('region', { name: 'Done. 11 leads are ready.' }),
    ).toBeVisible();
    expect(await screen.findByText('run-old company 0')).toBeVisible();
  });

  it('puts the linked run first when it is one of the active ones', async () => {
    show({ 'GET /api/runs/run-b': { body: runDetail(tunis) } }, '/leadgen/runs/run-b');
    await screen.findByRole('region', { name: /Running now|This run/ });
    act(() => lastStream().emit('runs', { runs: [sfax, tunis] }));
    const titles = Array.from(
      screen.getByRole('region', { name: 'Running now' }).querySelectorAll('.run-card h2'),
    ).map((h) => h.textContent);
    expect(titles[0]).toBe('Found 24 companies, checking which ones move goods...');
  });

  it('says so when the linked run does not exist', async () => {
    show(
      { 'GET /api/runs/nope': { status: 404, body: { error: 'not found' } } },
      '/leadgen/runs/nope',
    );
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  it('opens on the logs when no run is going, and on the run when one is', async () => {
    const quiet = show(
      { 'GET /api/apify/log': { runs: [], attention: [], recent: page([]) } },
      '/leadgen/runs',
    );
    act(() => lastStream().emit('runs', { runs: [] }));
    expect(await screen.findByRole('radio', { name: 'Logs' })).toBeChecked();
    expect(screen.queryByRole('region', { name: 'Running now' })).toBeNull();
    quiet.unmount();

    show({ 'GET /api/apify/log': { runs: [], attention: [], recent: page([]) } }, '/leadgen/runs');
    act(() => lastStream().emit('runs', { runs: [sfax] }));
    expect(await screen.findByRole('radio', { name: 'Live run' })).toBeChecked();
    expect(await screen.findByRole('region', { name: 'Running now' })).toBeVisible();
  });

  it('lets the person switch views, and what they picked stays even when a run starts', async () => {
    const { user } = show(
      { 'GET /api/apify/log': { runs: [], attention: [], recent: page([]) } },
      '/leadgen/runs',
    );
    act(() => lastStream().emit('runs', { runs: [] }));
    await user.click(await screen.findByRole('radio', { name: 'Live run' }));
    expect(await screen.findByRole('region', { name: 'Running now' })).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Logs' }));
    act(() => lastStream().emit('runs', { runs: [sfax] }));
    expect(screen.getByRole('radio', { name: 'Logs' })).toBeChecked();
    expect(screen.queryByRole('region', { name: 'Running now' })).toBeNull();
  });
});
