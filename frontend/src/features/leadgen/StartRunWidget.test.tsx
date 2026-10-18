import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes, preview, run } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { parseWordings, StartRunWidget } from './StartRunWidget.js';

function setup(extra = {}) {
  const server = fakeServer({
    ...dashboardRoutes(),
    'POST /api/runs/preview': { body: preview() },
    ...extra,
  });
  let started = 0;
  renderWith(<StartRunWidget onStarted={() => started++} />, server);
  return { server, started: () => started, user: userEvent.setup() };
}

async function pickRegion(user: ReturnType<typeof userEvent.setup>, name = 'Sfax') {
  await screen.findByRole('option', { name });
  await user.selectOptions(screen.getByLabelText('Region'), name);
}

describe('Start a run', () => {
  it('shows the suggested region with the scheduler’s reason, and can use it', async () => {
    const { user } = setup();
    expect(await screen.findByText(/Highest leads per dollar so far/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Sfax' }));
    expect(screen.getByLabelText('Region')).toHaveValue('sfax');
  });

  it('shows coverage, yield and cost per lead for the chosen region', async () => {
    const { user } = setup();
    await pickRegion(user, 'Sfax');
    const coverage = await screen.findByRole('region', { name: 'Coverage in Sfax' });
    expect(within(coverage).getByText('25%')).toBeInTheDocument();
    expect(within(coverage).getByText('4.5')).toBeInTheDocument();
    expect(within(coverage).getByText('$0.60')).toBeInTheDocument();
  });

  it('previews cost and volume as an estimate without starting anything', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    const box = await screen.findByRole('region', { name: 'Estimate' });
    await within(box).findByText('$3.50');
    expect(box.querySelector('.tag-estimate')).toHaveTextContent('Estimate');
    expect(server.to('POST /api/runs/preview')[0]!.body).toEqual({ regionId: 'sfax' });
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('requires a spend cap before a run can be reviewed', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    await screen.findByText('$3.50');
    const review = screen.getByRole('button', { name: 'Review and start' });
    expect(review).toBeDisabled();
    await user.type(screen.getByLabelText('Spend cap (USD)'), '0');
    await user.tab();
    expect(await screen.findByText('Enter a spend cap above zero.')).toBeInTheDocument();
    expect(review).toBeDisabled();
    await user.clear(screen.getByLabelText('Spend cap (USD)'));
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    await waitFor(() => expect(review).toBeEnabled());
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('sends the cap with the preview once it is valid', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    await waitFor(() =>
      expect(server.to('POST /api/runs/preview').some((c) => c.body.budgetCapUsd === 5)).toBe(true),
    );
  });

  it('starts nothing until the confirm step is accepted, and cancelling starts nothing', async () => {
    const { server, user } = setup({
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    const review = screen.getByRole('button', { name: 'Review and start' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);

    const dialog = await screen.findByRole('dialog', { name: 'Confirm this run' });
    expect(dialog).toHaveTextContent('It will not spend more than $5.00');
    expect(server.to('POST /api/runs')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(server.to('POST /api/runs')).toHaveLength(0);
  });

  it('starts the run with confirm and the cap, then links to it', async () => {
    const { server, user, started } = setup({
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    const review = screen.getByRole('button', { name: 'Review and start' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    await user.click(await screen.findByRole('button', { name: 'Confirm and start run' }));

    expect(await screen.findByText(/Run started in sfax/)).toBeInTheDocument();
    expect(server.to('POST /api/runs')[0]!.body).toEqual({
      regionId: 'sfax',
      budgetCapUsd: 5,
      confirm: true,
    });
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-9',
    );
    expect(started()).toBe(1);
  });

  it('blocks the start and says why when the preview finds a blocker', async () => {
    const { user } = setup({
      'POST /api/runs/preview': {
        body: preview({
          blockers: [
            { code: 'concurrent_run_limit', message: '2 runs are already active (limit 2)' },
          ],
        }),
      },
    });
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    expect(await screen.findByText('2 runs are already active (limit 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and start' })).toBeDisabled();
  });

  it('explains when paid runs are switched off on the server', async () => {
    const { user } = setup({
      'POST /api/runs': { status: 403, body: { error: 'paid_runs_disabled' } },
    });
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    const review = screen.getByRole('button', { name: 'Review and start' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    await user.click(await screen.findByRole('button', { name: 'Confirm and start run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paid runs are switched off on this server',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows an error with a retry when the estimate fails', async () => {
    const { user } = setup({
      'POST /api/runs/preview': { status: 500, body: { error: 'internal' } },
    });
    await pickRegion(user);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and start' })).toBeDisabled();
  });
});

describe('Start a run: search plan', () => {
  it('lists the planned searches per cell and the total', async () => {
    const { user } = setup();
    await pickRegion(user);
    const plan = await screen.findByRole('region', { name: 'Search plan' });
    expect(await within(plan).findByText('transport marchandises')).toBeInTheDocument();
    expect(within(plan).getByText('Cell r0c0')).toBeInTheDocument();
    expect(within(plan).getByText(/2 of 2 shown/)).toBeInTheDocument();
  });

  it('sends only the ticked sectors and the extra wordings, deduplicated by the server', async () => {
    const { server, user } = setup();
    await pickRegion(user);
    const plan = await screen.findByRole('region', { name: 'Search plan' });
    await user.click(await within(plan).findByRole('checkbox', { name: 'Road freight' }));
    await user.type(within(plan).getByLabelText(/Extra searches/), 'camion frigorifique');
    await waitFor(() =>
      expect(
        server
          .to('POST /api/runs/preview')
          .some(
            (c) =>
              JSON.stringify(c.body.sectorIds) === JSON.stringify(['import-export']) &&
              JSON.stringify(c.body.customWordings) === JSON.stringify(['camion frigorifique']),
          ),
      ).toBe(true),
    );
  });

  it('blocks the review when no sector and no wording is left', async () => {
    const { user } = setup();
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    await user.click(await screen.findByRole('button', { name: 'No sector selected' }));
    expect(
      await screen.findByText('Pick at least one sector or type an extra search.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and start' })).toBeDisabled();
  });

  it('rejects more than 20 wordings and wordings over 80 characters', async () => {
    const { user } = setup();
    await pickRegion(user);
    const box = await screen.findByLabelText(/Extra searches/);
    await user.click(box);
    await user.paste('x'.repeat(81));
    expect(await screen.findByText('A line is longer than 80 characters.')).toBeInTheDocument();
    await user.clear(box);
    await user.paste(Array.from({ length: 21 }, (_, i) => `mot ${i}`).join('\n'));
    expect(await screen.findByText('Too many lines: the most allowed is 20.')).toBeInTheDocument();
  });

  it('shows the final query count in the confirm dialog and sends the plan on start', async () => {
    const { server, user } = setup({
      'POST /api/runs': { status: 201, body: run({ id: 'run-9', status: 'running' }) },
    });
    await pickRegion(user);
    await user.type(screen.getByLabelText('Spend cap (USD)'), '5');
    await user.type(await screen.findByLabelText(/Extra searches/), 'camion frigorifique');
    const review = screen.getByRole('button', { name: 'Review and start' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm this run' });
    expect(dialog).toHaveTextContent('2 searches across 1 map cells');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and start run' }));
    await screen.findByText(/Run started/);
    expect(server.to('POST /api/runs')[0]!.body).toMatchObject({
      regionId: 'sfax',
      customWordings: ['camion frigorifique'],
      confirm: true,
    });
  });

  it('applies a prefill from the coverage views', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'POST /api/runs/preview': { body: preview() },
    });
    renderWith(
      <StartRunWidget
        onStarted={() => {}}
        prefill={{ regionId: 'sfax', sectorIds: ['import-export'], cellKeys: ['r0c0'], nonce: 1 }}
      />,
      server,
    );
    expect(await screen.findByText('Only these map cells: r0c0')).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Import and export' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Road freight' })).not.toBeChecked();
    expect(screen.getByLabelText('Region')).toHaveValue('sfax');
  });
});

describe('parseWordings', () => {
  it('trims, collapses spaces and drops blank lines', () => {
    expect(parseWordings('  a   b \n\n c ')).toEqual(['a b', 'c']);
  });
});
