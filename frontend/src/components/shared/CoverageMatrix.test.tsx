import type { Coverage } from '@lead-gen-crm/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { coverageRows, type Metric } from '../../lib/coverageView.js';
import { region } from '../../test/fixtures.js';
import { CoverageMatrix } from './CoverageMatrix.js';

const data: Coverage = {
  regions: [
    { regionId: 'gabes', name: 'Gabès' },
    { regionId: 'sfax', name: 'Sfax' },
    { regionId: 'tunis', name: 'Tunis' },
  ],
  sectors: [
    { id: 'agri-food', name: 'Agri-food' },
    { id: 'textile', name: 'Textile' },
  ],
  entries: [
    {
      regionId: 'sfax',
      sectorId: 'agri-food',
      queriesRun: 12,
      newPlaces: 40,
      leads: 5,
      spendUsd: 2.5,
      costPerLeadUsd: 0.5,
      lastRunAt: '2026-10-17T10:00:00.000Z',
      state: 'yielding',
    },
    {
      regionId: 'sfax',
      sectorId: 'textile',
      queriesRun: 20,
      newPlaces: 3,
      leads: 9,
      spendUsd: 6,
      costPerLeadUsd: 0.67,
      lastRunAt: '2026-08-01T10:00:00.000Z',
      state: 'maintenance',
    },
  ],
};
const rows = coverageRows(data, [
  region({ regionId: 'sfax', name: 'Sfax', coverage: 0.5 }),
  region({ regionId: 'tunis', name: 'Tunis', coverage: 0.1 }),
  region({ regionId: 'gabes', name: 'Gabès', hasBounds: false, runs: 0, leads: 0, coverage: null }),
]);

function setup(metric: Metric = 'status', extra = {}) {
  const onPlanRegion = vi.fn();
  const onPlanSector = vi.fn();
  const onSelectCell = vi.fn();
  render(
    <I18nProvider>
      <CoverageMatrix
        data={data}
        rows={rows}
        metric={metric}
        selected={{ regionId: null, sectorId: null }}
        onPlanRegion={onPlanRegion}
        onPlanSector={onPlanSector}
        onSelectCell={onSelectCell}
        {...extra}
      />
    </I18nProvider>,
  );
  return { onPlanRegion, onPlanSector, onSelectCell, user: userEvent.setup() };
}

describe('CoverageMatrix', () => {
  it('lists every region, explored ones first, with the greyed one last', () => {
    setup();
    const names = screen
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
      .filter((n) => n !== 'Total');
    expect(names).toEqual(['Sfax', 'Tunis', 'Gabès']);
  });

  it('names each sector column by an icon button with an accessible name', () => {
    setup();
    const agri = screen.getByRole('button', { name: 'Start a run for Agri-food' });
    expect(agri).toHaveAttribute('title', 'Agri-food');
    expect(screen.getByRole('button', { name: 'Start a run for Textile' })).toBeInTheDocument();
  });

  it('greys out a region with no data: disabled squares that cannot be selected', async () => {
    const { onSelectCell, onPlanRegion, user } = setup();
    const grey = screen.getByRole('button', { name: 'Gabès, Textile, Not explored yet' });
    expect(grey).toHaveAttribute('aria-disabled', 'true');
    await user.click(grey);
    await user.click(screen.getByRole('button', { name: 'Gabès' }));
    expect(onSelectCell).not.toHaveBeenCalled();
    expect(onPlanRegion).not.toHaveBeenCalled();
    await user.hover(grey);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Not explored yet');
  });

  it('marks the state with a symbol as well as a colour', () => {
    setup();
    const partial = screen.getByRole('button', { name: 'Sfax, Agri-food, Partial' });
    const maintenance = screen.getByRole('button', { name: 'Sfax, Textile, Maintenance' });
    expect(partial).toHaveAttribute('data-state', 'yielding');
    expect(partial.querySelector('svg')).not.toBeNull();
    expect(maintenance.querySelector('svg')).not.toBeNull();
    // A square never searched has no symbol, only its (grey) state in the name.
    expect(
      screen.getByRole('button', { name: 'Tunis, Textile, Unexplored' }).querySelector('svg'),
    ).toBeNull();
  });

  it('shows region, sector, state, leads, cost and last run in a tooltip on hover', async () => {
    const { user } = setup();
    await user.hover(screen.getByRole('button', { name: 'Sfax, Agri-food, Partial' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Sfax, Agri-food');
    expect(within(tip).getByText('Partial')).toBeVisible();
    expect(within(tip).getByText('5')).toBeVisible();
    expect(within(tip).getByText('$2.50')).toBeVisible();
    expect(within(tip).getByText('17 Oct 2026')).toBeVisible();
  });

  it('starts a run from a region title or a sector icon, and selects from a square', async () => {
    const { onSelectCell, onPlanRegion, onPlanSector, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Start a run in Sfax' }));
    expect(onPlanRegion).toHaveBeenCalledWith('sfax');
    await user.click(screen.getByRole('button', { name: 'Start a run for Agri-food' }));
    expect(onPlanSector).toHaveBeenCalledWith('agri-food');
    expect(onSelectCell).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tunis, Textile, Unexplored' }));
    expect(onSelectCell).toHaveBeenCalledWith('tunis', 'textile');
  });

  it('changes what the squares show with the metric', () => {
    setup('leads');
    expect(screen.getByRole('button', { name: 'Sfax, Agri-food, Partial' })).toHaveTextContent('5');
    expect(screen.getByRole('button', { name: 'Sfax, Textile, Maintenance' })).toHaveTextContent(
      '9',
    );
    expect(screen.getByRole('button', { name: 'Sfax, Textile, Maintenance' })).toHaveAttribute(
      'data-level',
      '4',
    );
  });

  it.each([
    ['status', ['1', '1']],
    ['leads', ['5', '9']],
    ['cost', ['$2.5', '$6.0']],
    ['yield', ['3.3', '0.1']],
  ] as const)('ends each sector column with its total for %s', (metric, totals) => {
    setup(metric);
    const foot = screen.getAllByRole('rowheader').find((h) => h.textContent === 'Total')!;
    const cells = within(foot.closest('tr')!).getAllByRole('cell');
    expect(cells.slice(0, 2).map((c) => c.textContent)).toEqual(totals);
  });

  it('ends each explored region with a thin coverage bar and not the greyed one', () => {
    setup();
    expect(screen.getByRole('progressbar', { name: 'Coverage of Sfax' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.queryByRole('progressbar', { name: 'Coverage of Gabès' })).toBeNull();
  });

  it('keeps one tab stop and moves between squares with the arrow keys', async () => {
    const { user } = setup();
    // The rows have one tab stop between them; the sector buttons in the header have their own.
    const body = within(screen.getAllByRole('rowgroup')[1]!);
    expect(
      body.getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0'),
    ).toHaveLength(1);
    await user.tab(); // Agri-food
    await user.tab(); // Textile
    await user.tab();
    expect(screen.getByRole('button', { name: 'Start a run in Sfax' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Sfax, Agri-food, Partial' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Tunis, Agri-food, Unexplored' })).toHaveFocus();
  });

  it('selects with Enter and Space', async () => {
    const { onSelectCell, user } = setup();
    screen.getByRole('button', { name: 'Start a run in Sfax' }).focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onSelectCell).toHaveBeenCalledWith('sfax', 'agri-food');
    await user.keyboard('{ArrowRight} ');
    expect(onSelectCell).toHaveBeenCalledWith('sfax', 'textile');
  });
});
