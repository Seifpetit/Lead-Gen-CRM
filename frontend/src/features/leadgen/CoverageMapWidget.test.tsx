import type { CellSummary } from '@lead-gen-crm/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cellState } from '../../lib/mapGeometry.js';
import { dashboardRoutes, page } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { CoverageMapWidget } from './CoverageMapWidget.js';

const square = (w: number, s: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [w, s],
      [w + 1, s],
      [w + 1, s + 1],
      [w, s + 1],
      [w, s],
    ],
  ],
});

const cell = (over: Partial<CellSummary>): CellSummary => ({
  regionCellId: 'id',
  cellKey: 'r0c0',
  bounds: { south: 34, west: 10, north: 34.5, east: 10.5 },
  spendUsd: 0,
  leads: 0,
  queriesRun: 0,
  placesFound: 0,
  newPlacesFound: 0,
  lastRunAt: null,
  exhaustedAt: null,
  claimedByRunId: null,
  ...over,
});

function setup() {
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/regions/geometry': {
      items: [
        {
          regionId: 'sfax',
          name: 'Sfax',
          bounds: { south: 34, west: 10, north: 35, east: 11 },
          outline: square(10, 34),
        },
        { regionId: 'tunis', name: 'Tunis', bounds: null, outline: null },
      ],
    },
    'GET /api/regions/sfax/cells': page([
      cell({ regionCellId: 'a', cellKey: 'r0c0' }),
      cell({ regionCellId: 'b', cellKey: 'r0c1', queriesRun: 3, leads: 2, spendUsd: 1.5 }),
      cell({ regionCellId: 'c', cellKey: 'r1c0', claimedByRunId: 'run-1' }),
    ]),
  });
  const onPick = vi.fn();
  renderWith(<CoverageMapWidget refreshKey={0} onPick={onPick} />, server);
  return { onPick, user: userEvent.setup() };
}

describe('cellState', () => {
  it('ranks claimed, saturated, leads, searched, never', () => {
    expect(cellState(cell({ claimedByRunId: 'r', exhaustedAt: 'x', leads: 1 }))).toBe('claimed');
    expect(cellState(cell({ exhaustedAt: '2026-10-01T00:00:00Z', leads: 1 }))).toBe('saturated');
    expect(cellState(cell({ leads: 1, queriesRun: 2 }))).toBe('leads');
    expect(cellState(cell({ queriesRun: 2 }))).toBe('searched');
    expect(cellState(cell({}))).toBe('never');
  });
});

describe('Coverage map', () => {
  it('draws regions that have an outline and names those that do not', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Region Sfax' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Region Tunis' })).not.toBeInTheDocument();
    expect(screen.getByText('No outline yet for: Tunis')).toBeInTheDocument();
  });

  it('zooms to the cells of a clicked region, coloured by state', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
    const never = await screen.findByRole('button', { name: 'Cell r0c0, Never searched' });
    expect(never).toHaveClass('cell-never');
    expect(screen.getByRole('button', { name: 'Cell r0c1, Searched, with leads' })).toHaveClass(
      'cell-leads',
    );
    expect(screen.getByRole('button', { name: 'Cell r1c0, In an active run' })).toHaveClass(
      'cell-claimed',
    );
  });

  it('shows a cell’s stats and preselects it in Start a run', async () => {
    const { onPick, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
    await user.click(await screen.findByRole('button', { name: /Cell r0c1/ }));
    expect(onPick).toHaveBeenCalledWith({ regionId: 'sfax', cellKeys: ['r0c1'] });
    expect(await screen.findByRole('region', { name: 'Cell r0c1' })).toHaveTextContent('$1.50');
  });
});
