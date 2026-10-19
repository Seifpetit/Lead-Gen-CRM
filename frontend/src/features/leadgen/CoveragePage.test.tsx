import type { Coverage, RegionGeometry } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes, page, preview, region, run } from '../../test/fixtures.js';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { CoveragePage } from './CoveragePage.js';

const square = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
const geometry: { items: RegionGeometry[] } = {
  items: [
    {
      regionId: 'sfax',
      name: 'Sfax',
      bounds: { south: 34.5, west: 10.2, north: 35.2, east: 11.0 },
      outline: square(10.2, 34.5, 11.0, 35.2),
      outlineSource: 'osm',
    },
    {
      regionId: 'tunis',
      name: 'Tunis',
      bounds: { south: 36.7, west: 10.0, north: 36.9, east: 10.3 },
      outline: square(10.0, 36.7, 10.3, 36.9),
      outlineSource: 'osm',
    },
    {
      regionId: 'gabes',
      name: 'Gabès',
      bounds: { south: 33.0, west: 9.5, north: 33.9, east: 10.5 },
      outline: square(9.5, 33.0, 10.5, 33.9),
      outlineSource: 'bounds',
    },
  ],
};
const coverage: Coverage = {
  regions: [
    { regionId: 'gabes', name: 'Gabès' },
    { regionId: 'tunis', name: 'Tunis' },
    { regionId: 'sfax', name: 'Sfax' },
  ],
  sectors: [
    { id: 'agri-food', name: 'Agri-food' },
    { id: 'textile', name: 'Textile' },
  ],
  entries: [
    {
      regionId: 'sfax',
      sectorId: 'textile',
      queriesRun: 12,
      newPlaces: 40,
      leads: 5,
      spendUsd: 2.5,
      costPerLeadUsd: 0.5,
      lastRunAt: '2026-10-17T10:00:00.000Z',
      state: 'yielding',
    },
  ],
};
const regions = [
  region({ regionId: 'sfax', name: 'Sfax', coverage: 0.5 }),
  region({ regionId: 'tunis', name: 'Tunis', coverage: 0.1, runs: 0, leads: 0 }),
  // No bounds, never run, no leads: greyed out.
  region({ regionId: 'gabes', name: 'Gabès', hasBounds: false, runs: 0, leads: 0, coverage: null }),
];
const runs = [
  run({ id: 'old', region: 'sfax', sectors: ['textile'], createdAt: '2026-10-10T09:00:00.000Z' }),
  run({ id: 'new', region: 'tunis', sectors: [], createdAt: '2026-10-18T09:00:00.000Z' }),
];

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}

function setup(route = '/leadgen/coverage') {
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/regions': page(regions),
    'GET /api/coverage': coverage,
    'GET /api/regions/geometry': geometry,
    'GET /api/regions/sfax/cells': page([]),
    'GET /api/runs': page(runs),
    'POST /api/runs/preview': { body: preview() },
  });
  renderWith(
    <>
      <Routes>
        <Route path="/leadgen/coverage" element={<CoveragePage />} />
      </Routes>
      <Where />
    </>,
    server,
    route,
  );
  return { server, user: userEvent.setup() };
}

const where = () => screen.getByTestId('where').textContent;
const map = () => screen.getByRole('group', { name: 'Coverage map' });

describe('Coverage page', () => {
  it('is one panel: a slim header, the matrix and the map, with no history in it', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Coverage', level: 1 })).toBeVisible();
    const header = screen.getByRole('heading', { name: 'Coverage', level: 1 }).closest('header')!;
    expect(within(header).getByRole('radio', { name: 'Status' })).toBeChecked();
    expect(within(header).getByRole('button', { name: 'Expand' })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Coverage by sector' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Coverage map' })).toBeVisible();
    expect(screen.queryByText('History results')).toBeNull();
    expect(document.querySelectorAll('.dash-panel')).toHaveLength(1);
  });

  it('shows every region, explored first by coverage and the greyed one last', async () => {
    setup();
    await screen.findByRole('grid', { name: 'Coverage by sector' });
    const names = screen
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
      .filter((n) => n !== 'Total');
    expect(names).toEqual(['Sfax', 'Tunis', 'Gabès']);
    expect(
      screen.getByRole('button', { name: 'Gabès, Textile, Not explored yet' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('switches the metric the squares show', async () => {
    const { user } = setup();
    const cell = await screen.findByRole('button', { name: 'Sfax, Textile, Partial' });
    expect(cell).toHaveAttribute('data-metric', 'status');
    await user.click(screen.getByRole('radio', { name: 'Leads' }));
    expect(screen.getByRole('button', { name: 'Sfax, Textile, Partial' })).toHaveTextContent('5');
    await user.click(screen.getByRole('radio', { name: 'Cost' }));
    expect(screen.getByRole('button', { name: 'Sfax, Textile, Partial' })).toHaveTextContent('2.5');
  });

  it('opens a detail card under the matrix when a square is clicked, and keeps it in the address', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Sfax, Textile, Partial' }));
    const card = screen.getByRole('region', { name: 'Sfax, Textile' });
    expect(within(card).getByText('$2.50')).toBeVisible();
    expect(within(card).getByText('17 Oct 2026')).toBeVisible();
    expect(where()).toBe('?region=sfax&sector=textile');
    // Still the matrix, not the table: the page does not change shape.
    expect(screen.getByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
    await user.click(within(card).getByRole('button', { name: 'Clear the selected sector' }));
    expect(screen.queryByRole('region', { name: 'Sfax, Textile' })).toBeNull();
    expect(where()).toBe('?region=sfax');
  });

  it('opens Create run prefilled with the region and sector from the detail card', async () => {
    const { server, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Sfax, Textile, Partial' }));
    await user.click(screen.getByRole('button', { name: 'Plan a run here' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create run' });
    await waitFor(() => expect(within(dialog).getByLabelText('Region')).toHaveValue('sfax'));
    await waitFor(() =>
      expect(server.to('POST /api/runs/preview').at(-1)!.body).toMatchObject({
        regionId: 'sfax',
        sectorIds: ['textile'],
      }),
    );
  });

  describe('picking a region', () => {
    it('turns the matrix into that region’s table and focuses the map on it', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      expect(await screen.findByRole('region', { name: 'Sfax by sector' })).toBeVisible();
      expect(screen.queryByRole('grid')).toBeNull();
      const table = screen.getByRole('table', { name: 'Sfax by sector' });
      const head = within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent);
      expect(head.slice(0, 6)).toEqual(['Sector', 'State', 'Leads', 'Cost', 'Yield', 'Last run']);
      const textile = within(table).getByRole('row', { name: /Textile/ });
      expect(within(textile).getByText('Partial')).toBeVisible();
      expect(within(textile).getByText('3.3')).toBeVisible();
      expect(
        within(textile).getByRole('button', { name: 'Plan a run in Sfax for Textile' }),
      ).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', 'sfax');
      expect(screen.getByRole('button', { name: 'Region Tunis' })).toHaveClass('is-dimmed');
      expect(where()).toBe('?region=sfax');
    });

    it('does the same when the region’s label in the matrix is clicked', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Tunis' }));
      expect(await screen.findByRole('table', { name: 'Tunis by sector' })).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', 'tunis');
    });

    it('opens Create run from a table row for that region and sector', async () => {
      const { server, user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      await user.click(
        await screen.findByRole('button', { name: 'Plan a run in Sfax for Agri-food' }),
      );
      await screen.findByRole('dialog', { name: 'Create run' });
      await waitFor(() =>
        expect(server.to('POST /api/runs/preview').at(-1)!.body).toMatchObject({
          regionId: 'sfax',
          sectorIds: ['agri-food'],
        }),
      );
    });

    it('cannot pick a greyed-out region on the map', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Gabès' }));
      await user.click(screen.getByRole('button', { name: 'Gabès' }));
      expect(where()).toBe('');
      expect(map()).toHaveAttribute('data-focus', '');
      expect(screen.getByRole('grid')).toBeVisible();
    });

    it('goes back to the matrix and the whole map when the empty panel is clicked', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      await screen.findByRole('table', { name: 'Sfax by sector' });
      await user.click(screen.getByRole('heading', { name: 'Coverage', level: 1 }));
      expect(await screen.findByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', '');
      expect(screen.getByRole('button', { name: 'Region Tunis' })).not.toHaveClass('is-dimmed');
      expect(where()).toBe('');
    });

    it('goes back when the empty map background is clicked', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      await screen.findByRole('table', { name: 'Sfax by sector' });
      await user.click(map());
      expect(await screen.findByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
      expect(where()).toBe('');
    });

    it('goes back with Escape', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      await screen.findByRole('table', { name: 'Sfax by sector' });
      await user.keyboard('{Escape}');
      expect(await screen.findByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', '');
      expect(where()).toBe('');
    });

    it('stays put when the table itself is clicked, and has a button back', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Region Sfax' }));
      const table = await screen.findByRole('table', { name: 'Sfax by sector' });
      await user.click(within(table).getByText('Textile'));
      expect(where()).toBe('?region=sfax');
      await user.click(screen.getByRole('button', { name: 'All regions' }));
      expect(await screen.findByRole('grid')).toBeVisible();
    });

    it('restores the pick from the address, and ignores a region that is greyed or unknown', async () => {
      setup('/leadgen/coverage?region=sfax');
      expect(await screen.findByRole('table', { name: 'Sfax by sector' })).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', 'sfax');
    });

    it('shows the matrix for a greyed-out region in the address', async () => {
      setup('/leadgen/coverage?region=gabes');
      expect(await screen.findByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
      expect(map()).toHaveAttribute('data-focus', '');
    });
  });

  describe('the Expand window', () => {
    it('opens a larger matrix with the metric switch and a History results tab', async () => {
      const { user } = setup();
      const button = await screen.findByRole('button', { name: 'Expand' });
      await user.click(button);
      const dialog = await screen.findByRole('dialog', { name: 'Coverage' });
      expect(within(dialog).getByRole('tab', { name: 'Matrix' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(within(dialog).getByRole('grid', { name: 'Coverage by sector' })).toBeVisible();
      await user.click(within(dialog).getByRole('radio', { name: 'Leads' }));
      expect(
        within(dialog).getByRole('button', { name: 'Sfax, Textile, Partial' }),
      ).toHaveTextContent('5');
      // The panel behind uses the same metric.
      expect(
        screen
          .getAllByRole('button', { name: 'Sfax, Textile, Partial' })
          .every((b) => b.getAttribute('data-metric') === 'leads'),
      ).toBe(true);
    });

    it('lists past runs newest first, with a region filter', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Expand' }));
      const dialog = await screen.findByRole('dialog', { name: 'Coverage' });
      await user.click(within(dialog).getByRole('tab', { name: 'History results' }));
      const table = await within(dialog).findByRole('table', { name: 'History results' });
      const body = () =>
        within(table)
          .getAllByRole('row')
          .slice(1)
          .map((r) => r.textContent);
      expect(body()).toHaveLength(2);
      expect(body()[0]).toContain('Tunis');
      expect(body()[0]).toContain('All sectors');
      expect(body()[1]).toContain('Sfax');
      expect(body()[1]).toContain('Textile');
      const head = within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent);
      expect(head).toEqual(['Date', 'Region', 'Sector', 'Leads found', 'Cost', 'Status']);
      await user.selectOptions(within(dialog).getByLabelText('Region'), 'Sfax');
      expect(body()).toHaveLength(1);
      expect(body()[0]).toContain('Sfax');
    });

    it('closes with Escape and gives the focus back to the Expand button', async () => {
      const { user } = setup();
      const button = await screen.findByRole('button', { name: 'Expand' });
      await user.click(button);
      await screen.findByRole('dialog', { name: 'Coverage' });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button).toHaveFocus();
    });

    it('keeps the pick when Escape closes the window', async () => {
      const { user } = setup('/leadgen/coverage?region=sfax');
      await screen.findByRole('table', { name: 'Sfax by sector' });
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      await screen.findByRole('dialog', { name: 'Coverage' });
      await user.keyboard('{Escape}');
      expect(where()).toBe('?region=sfax');
      expect(screen.getByRole('table', { name: 'Sfax by sector' })).toBeVisible();
    });

    it('traps focus inside the window', async () => {
      const { user } = setup();
      await user.click(await screen.findByRole('button', { name: 'Expand' }));
      const dialog = await screen.findByRole('dialog', { name: 'Coverage' });
      for (let i = 0; i < 12; i++) await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });
  });

  it('says so when the regions cannot be loaded, with a way to retry', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/regions': page(regions),
      'GET /api/coverage': { status: 500, body: { error: { code: 'internal', message: 'x' } } },
      'GET /api/regions/geometry': geometry,
    });
    renderWith(<CoveragePage />, server, '/leadgen/coverage');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows an empty state when there are no regions', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/regions': page([]),
      'GET /api/coverage': { regions: [], sectors: [], entries: [] },
      'GET /api/regions/geometry': { items: [] },
    });
    renderWith(<CoveragePage />, server, '/leadgen/coverage');
    expect(await screen.findByText('No regions yet')).toBeVisible();
  });
});
