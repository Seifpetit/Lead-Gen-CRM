import type { Coverage } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { dashboardRoutes, page, preview, region, run } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { chooseOption } from '../../test/select.js';
import { parseWordings, StartRunWidget } from './StartRunWidget.js';

const entry = (sectorId: string, over = {}) => ({
  regionId: 'sfax',
  sectorId,
  queriesRun: 10,
  newPlaces: 40,
  leads: 5,
  spendUsd: 2,
  costPerLeadUsd: 0.4,
  lastRunAt: '2026-10-17T10:00:00.000Z',
  state: 'yielding' as const,
  ...over,
});

const startCoverage: Coverage = {
  regions: [
    { regionId: 'sfax', name: 'Sfax' },
    { regionId: 'tunis', name: 'Tunis' },
  ],
  sectors: [
    { id: 'road-freight', name: 'Road freight' },
    { id: 'import-export', name: 'Import and export' },
    { id: 'textile', name: 'Textile' },
  ],
  entries: [
    entry('road-freight'),
    entry('import-export', { newPlaces: 20 }),
    entry('textile', { state: 'saturated', newPlaces: 90 }),
  ],
};

const regions = [
  region(),
  region({ regionId: 'tunis', name: 'Tunis', coverage: null, runs: 0, leads: 0 }),
  region({ regionId: 'gabes', name: 'Gabès', hasBounds: false, coverage: null, runs: 0, leads: 0 }),
];

function setup(extra = {}) {
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/coverage': startCoverage,
    'GET /api/regions': page(regions),
    'POST /api/runs/preview': { body: preview() },
    ...extra,
  });
  let started = 0;
  renderWith(<StartRunWidget onStarted={() => started++} />, server);
  return { server, started: () => started, user: userEvent.setup() };
}

type User = ReturnType<typeof userEvent.setup>;

async function pickRegion(user: User, name = 'Sfax') {
  await chooseOption(user, await screen.findByLabelText('Region'), new RegExp(`^${name}`));
}

const chip = (name: string) => screen.getByRole('button', { name });
const startButton = () => screen.getByRole('button', { name: /^Start run/ });
const cap = () => screen.getByLabelText('Spend cap (USD)');

beforeEach(() => window.localStorage.clear());

describe('Start a run: region', () => {
  it('shows each region with its leads and how far it is covered, and disables one with no map area', async () => {
    const { user } = setup();
    await user.click(await screen.findByLabelText('Region'));
    expect(
      await screen.findByRole('option', { name: 'Sfax, 7 leads, partly covered' }),
    ).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Tunis, 0 leads, not searched yet' })).toBeEnabled();
    expect(
      screen.getByRole('option', { name: 'Gabès, no map area set, cannot be searched' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the suggested region with the scheduler’s reason, and can use it', async () => {
    const { user } = setup();
    expect(await screen.findByText(/Highest leads per dollar so far/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Sfax' }));
    expect(screen.getByLabelText('Region')).toHaveTextContent('Sfax');
    expect(screen.getByRole('button', { name: 'Use Sfax' })).toBeDisabled();
  });

  it('shows the first-test message and no Use button when nothing is suggested', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/coverage': startCoverage,
      'GET /api/regions/suggestion': {
        regionId: null,
        mode: 'normal',
        reason: 'Pick a region to start. We recommend a small one like Sfax for a first test.',
        widening: [],
        ranking: [],
      },
    });
    renderWith(<StartRunWidget onStarted={() => {}} />, server);
    expect(
      await screen.findByText(
        'Pick a region to start. We recommend a small one like Sfax for a first test.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument();
  });
});

describe('Start a run: sectors', () => {
  it('ticks only the suggested sector for the region, never all of them', async () => {
    const { user } = setup();
    await pickRegion(user);
    // Road freight yields the most new places per search among the sectors still yielding.
    await waitFor(() => expect(chip('Road freight')).toHaveAttribute('aria-pressed', 'true'));
    expect(chip('Import and export')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Textile')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
  });

  it('ticks nothing for a region with no history and says what to do', async () => {
    const { user } = setup();
    await pickRegion(user, 'Tunis');
    expect(await screen.findByText('0 of 3 selected')).toBeInTheDocument();
    expect(screen.getByText(/Pick at least one sector/)).toBeInTheDocument();
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('has All and None links, and chips that toggle', async () => {
    const { user } = setup();
    await pickRegion(user);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
    await user.click(chip('Textile'));
    expect(chip('Textile')).toHaveAttribute('aria-pressed', 'true');
    chip('Import and export').focus();
    await user.keyboard(' ');
    expect(chip('Import and export')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  });

  it('sends the ticked sectors with the estimate', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    await user.click(await screen.findByRole('button', { name: 'All' }));
    await waitFor(() =>
      expect(
        server
          .to('POST /api/runs/preview')
          .some(
            (c) =>
              JSON.stringify(c.body.sectorIds) ===
              JSON.stringify(['road-freight', 'import-export', 'textile']),
          ),
      ).toBe(true),
    );
  });
});

describe('Start a run: spend cap', () => {
  it('is filled in with $2.00 and the $2 quick choice is on', async () => {
    setup();
    expect(await screen.findByLabelText('Spend cap (USD)')).toHaveValue('2.00');
    expect(screen.getByRole('radio', { name: '$2' })).toBeChecked();
    expect(screen.getByText('The run stops before spending more than this.')).toBeInTheDocument();
  });

  it('takes the quick choices and shows the cap on the Start button', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: '$5' }));
    expect(cap()).toHaveValue('5.00');
    expect(startButton()).toHaveTextContent('Start run, up to $5.00');
    await user.click(screen.getByRole('radio', { name: '$1' }));
    expect(startButton()).toHaveTextContent('Start run, up to $1.00');
  });

  it('starts on the cap used last time', async () => {
    window.localStorage.setItem('leadgen.run.cap', '3.5');
    setup();
    expect(await screen.findByLabelText('Spend cap (USD)')).toHaveValue('3.50');
    expect(startButton()).toHaveTextContent('Start run, up to $3.50');
  });

  it('says why Start is off when the cap is empty or zero', async () => {
    const { user } = setup();
    await pickRegion(user);
    await user.clear(cap());
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
    expect(startButton()).toHaveTextContent('Start run');
    expect(screen.getByText('Enter an amount such as 2.50.')).toBeInTheDocument();
    await user.type(cap(), '0');
    await user.tab();
    expect(screen.getAllByText('The cap must be at least $0.50.')).toHaveLength(2);
  });
});

describe('Start a run: spend cap limits', () => {
  it('ignores a remembered cap that is out of range and starts on $2.00', async () => {
    window.localStorage.setItem('leadgen.run.cap', '5000000');
    setup();
    expect(await screen.findByLabelText('Spend cap (USD)')).toHaveValue('2.00');
    expect(startButton()).toHaveTextContent('Start run, up to $2.00');
  });

  it('says the cap is too high instead of showing it, and sends nothing', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    await user.clear(cap());
    await user.type(cap(), '5000000');
    await user.tab();
    expect(screen.getAllByText('The cap can be at most $50.00.').length).toBeGreaterThan(0);
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
    expect(startButton()).not.toHaveTextContent('5,000,000');
    expect(server.to('POST /api/runs/preview').every((c) => c.body.budgetCapUsd !== 5000000)).toBe(
      true,
    );
  });

  it('says the cap is too low, and accepts a decimal comma', async () => {
    const { user } = setup();
    await pickRegion(user);
    await user.clear(cap());
    await user.type(cap(), '0,25');
    await user.tab();
    expect(screen.getAllByText('The cap must be at least $0.50.').length).toBeGreaterThan(0);
    await user.clear(cap());
    await user.type(cap(), '2,5');
    await user.tab();
    expect(cap()).toHaveValue('2.50');
    expect(startButton()).toHaveTextContent('Start run, up to $2.50');
  });

  it('steps the cap by 50 cents and stops at the limits', async () => {
    const { user } = setup();
    await screen.findByLabelText('Region');
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    expect(cap()).toHaveValue('2.50');
    await user.clear(cap());
    await user.type(cap(), '0.5');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled();
  });
});

describe('Start a run: the estimate as a receipt', () => {
  it('shows dotted placeholders and a "..." total until the estimate arrives', async () => {
    const { user } = setup({ 'POST /api/runs/preview': { body: preview(), delayMs: 400 } });
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    expect(within(box).getByText('Estimated cost').closest('div')).toHaveTextContent('...');
    expect(within(box).getAllByText('·····').length).toBeGreaterThan(3);
    await within(box).findByText('$3.50');
    expect(within(box).queryByText('·····')).toBeNull();
  });

  it('lists the planned work, the total and the room left', async () => {
    const { user } = setup();
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    await within(box).findByText('$3.50');
    for (const label of [
      'Searches planned',
      'Places searched',
      'Qualified companies',
      'Expected leads',
      'Per lead',
      'Estimated cost',
      'Active runs',
      'Left this month',
    ]) {
      expect(within(box).getByText(label)).toBeInTheDocument();
    }
    expect(box.querySelector('.receipt-barcode')).toHaveAttribute('aria-hidden', 'true');
  });

  it('stamps ABOVE CAP, with the full sentence for a screen reader, when the estimate is over the cap', async () => {
    const { user } = setup();
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    const stamp = await within(box).findByRole('alert');
    expect(stamp).toHaveTextContent('Above cap');
    expect(stamp).toHaveTextContent('Estimate is above your cap');
    await user.click(screen.getByRole('radio', { name: '$5' }));
    await waitFor(() => expect(within(box).queryByRole('alert')).toBeNull());
  });
});

describe('Start a run: Suggested next', () => {
  it('is one line under the receipt, above the footer with Start', async () => {
    setup();
    const line = await screen.findByText(/Highest leads per dollar so far/);
    const strip = line.closest('section')!;
    const receipt = screen.getByRole('region', { name: 'Estimate' });
    expect(strip).toHaveTextContent('Suggested next:');
    expect(receipt.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.parentElement).toBe(receipt.parentElement);
    expect(
      strip.compareDocumentPosition(startButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The old yellow card was the first thing in the body; nothing is above the columns now.
    expect(document.querySelector('.sr > .sr-suggest')).toBeNull();
  });
});

describe('Start a run: estimate and Start button', () => {
  it('previews cost, a leads range and cost per lead as an estimate, spending nothing', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    await within(box).findByText('$3.50');
    expect(within(box).getByText('about 3 to 9')).toBeInTheDocument();
    expect(within(box).getByText('$0.58')).toBeInTheDocument();
    expect(within(box).getByText('0 / 2')).toBeInTheDocument();
    expect(within(box).getByText('$45.00')).toBeInTheDocument();
    await waitFor(() => expect(box.querySelector('.tag-estimate')).toHaveTextContent('Estimate'));
    expect(
      within(box).getByText(/Worst case before the first step finishes: \$3\.00/),
    ).toBeInTheDocument();
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('says "not enough data yet" instead of a bare zero', async () => {
    const base = preview();
    const { user } = setup({
      'POST /api/runs/preview': {
        body: preview({ volume: { ...base.volume, leads: 0 } }),
      },
    });
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    expect((await within(box).findAllByText('not enough data yet')).length).toBeGreaterThan(0);
  });

  it('warns when the estimate is above the cap', async () => {
    const { user } = setup();
    await pickRegion(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Estimate is above your cap, the run may stop early.',
    );
    await user.click(screen.getByRole('radio', { name: '$5' }));
    await waitFor(() =>
      expect(screen.queryByText(/Estimate is above your cap/)).not.toBeInTheDocument(),
    );
  });

  it('waits for the estimate: debounced, and sends the cap with it', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    await user.clear(cap());
    await user.type(cap(), '4');
    await waitFor(() =>
      expect(server.to('POST /api/runs/preview').some((c) => c.body.budgetCapUsd === 4)).toBe(true),
    );
    const bodies = server.to('POST /api/runs/preview').map((c) => c.body);
    expect(bodies.every((b) => b.regionId === 'sfax')).toBe(true);
  });

  it('keeps Start off until there is a region, and says so', async () => {
    setup();
    await screen.findByLabelText('Region');
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Choose a region to start.')).toBeInTheDocument();
  });

  it('blocks the start and says why when the estimate finds a blocker', async () => {
    const { user, server } = setup({
      'POST /api/runs/preview': {
        body: preview({
          blockers: [
            { code: 'concurrent_run_limit', message: '2 runs are already active (limit 2)' },
          ],
        }),
      },
    });
    await pickRegion(user);
    expect(
      (await screen.findAllByText('2 runs are already active (limit 2)')).length,
    ).toBeGreaterThan(0);
    await user.click(startButton());
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('shows an error with a retry when the estimate fails, and does not start', async () => {
    const { user } = setup({
      'POST /api/runs/preview': { status: 500, body: { error: 'internal' } },
    });
    await pickRegion(user);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Start a run: starting', () => {
  const started = {
    'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
  };

  it('starts in one click when the estimate is within the cap, and remembers the cap', async () => {
    const base = preview();
    const {
      server,
      user,
      started: count,
    } = setup({
      'POST /api/runs/preview': { body: preview({ cost: { ...base.cost, totalUsd: 1.5 } }) },
      ...started,
    });
    await pickRegion(user);
    await waitFor(() => expect(startButton()).toHaveAttribute('aria-disabled', 'false'));
    await user.click(startButton());
    await waitFor(() => expect(count()).toBe(1));
    expect(server.to('POST /api/runs')[0]!.body).toEqual({
      regionId: 'sfax',
      sectorIds: ['road-freight'],
      budgetCapUsd: 2,
      confirm: true,
    });
    expect(window.localStorage.getItem('leadgen.run.cap')).toBe('2');
  });

  it('asks once more when the estimate is above the cap, and starts nothing until yes', async () => {
    const { server, user, started: count } = setup(started);
    await pickRegion(user);
    await waitFor(() => expect(startButton()).toHaveAttribute('aria-disabled', 'false'));
    await user.click(startButton());
    expect(
      await screen.findByText(/The estimate \(\$3\.50\) is above your cap \(\$2\.00\)/),
    ).toBeInTheDocument();
    expect(server.to('POST /api/runs')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('button', { name: 'Yes, start the run' })).not.toBeInTheDocument();
    await user.click(startButton());
    await user.click(await screen.findByRole('button', { name: 'Yes, start the run' }));
    await waitFor(() => expect(count()).toBe(1));
    expect(server.to('POST /api/runs')).toHaveLength(1);
  });

  it('asks once more when the cap is above $5', async () => {
    const base = preview();
    const { server, user } = setup({
      'POST /api/runs/preview': { body: preview({ cost: { ...base.cost, totalUsd: 1 } }) },
      ...started,
    });
    await pickRegion(user);
    await user.clear(cap());
    await user.type(cap(), '8');
    await waitFor(() => expect(startButton()).toHaveAttribute('aria-disabled', 'false'));
    await user.click(startButton());
    expect(
      await screen.findByText('This run can spend up to $8.00. Start it?'),
    ).toBeInTheDocument();
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('explains when paid runs are switched off on the server', async () => {
    const base = preview();
    const { user } = setup({
      'POST /api/runs/preview': { body: preview({ cost: { ...base.cost, totalUsd: 1 } }) },
      'POST /api/runs': { status: 403, body: { error: 'paid_runs_disabled' } },
    });
    await pickRegion(user);
    await waitFor(() => expect(startButton()).toHaveAttribute('aria-disabled', 'false'));
    await user.click(startButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paid runs are switched off on this server',
    );
  });
});

describe('Start a run: advanced', () => {
  it('is collapsed by default and holds extra searches, the planned searches and the assumptions', async () => {
    const { user } = setup();
    await pickRegion(user);
    const advanced = screen.getByText('Advanced').closest('details')!;
    expect(advanced).not.toHaveAttribute('open');
    await user.click(screen.getByText('Advanced'));
    expect(advanced).toHaveAttribute('open');
    const plan = await screen.findByText('Searches that will run (2)');
    expect(plan.closest('details')).not.toHaveAttribute('open');
    await user.click(plan);
    expect(await screen.findByText('transport marchandises')).toBeInTheDocument();
    expect(screen.getByText('Cell r0c0')).toBeInTheDocument();
    expect(screen.getByText('How this was estimated').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('can start from extra searches alone, and sends them', async () => {
    const base = preview();
    const { server, user } = setup({
      'POST /api/runs/preview': { body: preview({ cost: { ...base.cost, totalUsd: 1 } }) },
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await pickRegion(user, 'Tunis');
    await user.click(screen.getByText('Advanced'));
    await user.type(screen.getByLabelText(/Extra searches/), 'camion frigorifique');
    await waitFor(() => expect(startButton()).toHaveAttribute('aria-disabled', 'false'));
    await user.click(startButton());
    await waitFor(() => expect(server.to('POST /api/runs')).toHaveLength(1));
    expect(server.to('POST /api/runs')[0]!.body).toMatchObject({
      regionId: 'tunis',
      sectorIds: [],
      customWordings: ['camion frigorifique'],
      confirm: true,
    });
  });

  it('rejects more than 20 wordings and wordings over 80 characters', async () => {
    const { user } = setup();
    await pickRegion(user);
    await user.click(screen.getByText('Advanced'));
    const box = await screen.findByLabelText(/Extra searches/);
    await user.click(box);
    await user.paste('x'.repeat(81));
    expect(await screen.findByText('A line is longer than 80 characters.')).toBeInTheDocument();
    await user.clear(box);
    await user.paste(Array.from({ length: 21 }, (_, i) => `mot ${i}`).join('\n'));
    expect(await screen.findByText('Too many lines: the most allowed is 20.')).toBeInTheDocument();
    expect(startButton()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Start a run: prefill from Coverage', () => {
  it('fills region, sector and map cells, and puts the focus on the sector', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/coverage': startCoverage,
      'GET /api/regions': page(regions),
      'POST /api/runs/preview': { body: preview() },
    });
    renderWith(
      <StartRunWidget
        onStarted={() => {}}
        prefill={{ regionId: 'sfax', sectorIds: ['textile'], cellKeys: ['r0c0'], nonce: 1 }}
      />,
      server,
    );
    await waitFor(() => expect(screen.getByLabelText('Region')).toHaveTextContent('Sfax'));
    await waitFor(() => expect(chip('Textile')).toHaveAttribute('aria-pressed', 'true'));
    expect(chip('Road freight')).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(chip('Textile')).toHaveFocus());
    await userEvent.setup().click(screen.getByText('Advanced'));
    expect(await screen.findByText('Only these map cells: r0c0')).toBeInTheDocument();
  });
});

describe('parseWordings', () => {
  it('trims, collapses spaces and drops blank lines', () => {
    expect(parseWordings('  a   b \n\n c ')).toEqual(['a b', 'c']);
  });
});
