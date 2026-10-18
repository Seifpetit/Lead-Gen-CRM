import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { dashboardRoutes } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { CoverageGridWidget } from './CoverageGridWidget.js';

const coverage = {
  regions: [
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
      state: 'yielding',
    },
    {
      regionId: 'tunis',
      sectorId: 'textile',
      queriesRun: 30,
      newPlaces: 0,
      leads: 2,
      spendUsd: 3,
      costPerLeadUsd: 1.5,
      state: 'saturated',
    },
  ],
};

function setup() {
  const server = fakeServer({ ...dashboardRoutes(), 'GET /api/coverage': coverage });
  const onPick = vi.fn();
  renderWith(<CoverageGridWidget refreshKey={0} onPick={onPick} />, server);
  return { onPick, user: userEvent.setup() };
}

describe('Coverage grid', () => {
  it('colours each region and sector square by state, with unsearched ones grey', async () => {
    setup();
    const table = await screen.findByRole('table');
    const squares = within(table).getAllByRole('button');
    expect(squares).toHaveLength(4);
    const byLabel = (re: RegExp) =>
      squares.find((b) => re.test(b.getAttribute('aria-label') ?? ''))!;
    expect(byLabel(/Sfax.*Agri-food.*Still yielding/)).toHaveClass('grid-yielding');
    expect(byLabel(/Tunis.*Textile.*Saturated/)).toHaveClass('grid-saturated');
    expect(byLabel(/Sfax.*Textile.*Not searched/)).toHaveClass('grid-not_searched');
  });

  it('shows the yield on hover', async () => {
    const { user } = setup();
    const square = within(await screen.findByRole('table'))
      .getAllByRole('button')
      .find((b) => /Sfax.*Agri-food/.test(b.getAttribute('aria-label') ?? ''))!;
    await user.hover(square);
    expect(await screen.findByText(/12 searches, 40 new places, 5 leads/)).toBeInTheDocument();
  });

  it('hands the region and sector to Start a run on click', async () => {
    const { onPick, user } = setup();
    const square = within(await screen.findByRole('table'))
      .getAllByRole('button')
      .find((b) => /Tunis.*Textile/.test(b.getAttribute('aria-label') ?? ''))!;
    await user.click(square);
    expect(onPick).toHaveBeenCalledWith({ regionId: 'tunis', sectorIds: ['textile'] });
  });
});
