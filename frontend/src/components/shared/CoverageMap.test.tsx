import type { CellSummary, RegionGeometry } from '@lead-gen-crm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { CoverageMap } from './CoverageMap.js';

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
const regions: RegionGeometry[] = [
  {
    country: 'TN',
    regionId: 'sfax',
    name: 'Sfax',
    bounds: { south: 34.5, west: 10.2, north: 35.2, east: 11.0 },
    outline: square(10.2, 34.5, 11.0, 35.2),
    outlineSource: 'osm',
  },
  {
    country: 'TN',
    regionId: 'tunis',
    name: 'Tunis',
    bounds: { south: 36.7, west: 10.0, north: 36.9, east: 10.3 },
    outline: square(10.0, 36.7, 10.3, 36.9),
    outlineSource: 'osm',
  },
  {
    country: 'TN',
    regionId: 'gabes',
    name: 'Gabès',
    bounds: { south: 33.0, west: 9.5, north: 33.9, east: 10.5 },
    outline: square(9.5, 33.0, 10.5, 33.9),
    outlineSource: 'bounds',
  },
  {
    country: 'TN',
    regionId: 'manouba',
    name: 'Manouba',
    bounds: null,
    outline: null,
    outlineSource: null,
  },
];
const cell = {
  regionCellId: 'c1',
  cellKey: 'r0c0',
  bounds: { south: 34.5, west: 10.2, north: 34.8, east: 10.6 },
  queriesRun: 3,
  placesFound: 20,
  newPlacesFound: 12,
  leads: 2,
  spendUsd: 0.4,
  lastRunAt: null,
  exhaustedAt: null,
  claimedByRunId: null,
} satisfies CellSummary;

const explored = new Set(['sfax', 'tunis']);

function setup(regionId: string | null = null) {
  const onRegionChange = vi.fn();
  const view = (id: string | null) => (
    <I18nProvider>
      <CoverageMap
        regions={regions}
        exploredIds={explored}
        regionId={id}
        onRegionChange={onRegionChange}
        cells={id ? [cell] : null}
      />
    </I18nProvider>
  );
  const utils = render(view(regionId));
  return {
    onRegionChange,
    user: userEvent.setup(),
    rerender: (id: string | null) => utils.rerender(view(id)),
  };
}

describe('CoverageMap', () => {
  it('draws a shape per outlined region and names the ones it cannot draw', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Region Sfax' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Region Tunis' })).toBeInTheDocument();
    expect(screen.getByText(/Manouba/)).toBeInTheDocument();
  });

  it('hands a clicked region to the caller', async () => {
    const { onRegionChange, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Region Sfax' }));
    expect(onRegionChange).toHaveBeenCalledWith('sfax');
  });

  it('greys out a region with nothing to show: not clickable, with a reason', async () => {
    const { onRegionChange, user } = setup();
    const grey = screen.getByRole('button', { name: 'Region Gabès' });
    expect(grey).toHaveAttribute('aria-disabled', 'true');
    expect(grey).toHaveClass('is-grey');
    expect(grey).toHaveAttribute('tabindex', '-1');
    expect(grey.querySelector('title')).toHaveTextContent('Gabès: Not explored yet');
    await user.click(grey);
    grey.focus();
    await user.keyboard('{Enter}');
    expect(onRegionChange).not.toHaveBeenCalled();
  });

  it('selects with Enter and Space from the keyboard', async () => {
    const { onRegionChange, user } = setup();
    screen.getByRole('button', { name: 'Region Tunis' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRegionChange).toHaveBeenCalledTimes(2);
  });

  it('focuses a picked region: it is outlined, the others are dimmed, and its cells appear', () => {
    setup('sfax');
    const svg = screen.getByRole('group', { name: 'Coverage map' });
    expect(svg).toHaveAttribute('data-focus', 'sfax');
    expect(screen.getByRole('button', { name: 'Region Sfax' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: 'Region Tunis' })).toHaveClass('is-dimmed');
    expect(screen.getByRole('button', { name: 'Region Sfax' })).not.toHaveClass('is-dimmed');
    expect(screen.getByRole('button', { name: /r0c0/ })).toBeInTheDocument();
  });

  it('zooms to the picked region and back out to the country', () => {
    // Motion is reduced in this test, so the view jumps to where it is going.
    const mm = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', mm);
    const { rerender } = setup();
    const svg = screen.getByRole('group', { name: 'Coverage map' });
    const whole = svg.getAttribute('viewBox');
    rerender('sfax');
    const zoomed = svg.getAttribute('viewBox');
    expect(zoomed).not.toBe(whole);
    const width = (box: string | null) => Number(box!.split(' ')[2]);
    expect(width(zoomed)).toBeLessThan(width(whole));
    rerender(null);
    expect(svg.getAttribute('viewBox')).toBe(whole);
    vi.unstubAllGlobals();
  });

  it('shows a cell’s numbers, with no button to plan a run', async () => {
    const { user } = setup('sfax');
    await user.click(screen.getByRole('button', { name: /r0c0/ }));
    expect(screen.getByRole('region', { name: 'Cell r0c0' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /plan a run/i })).toBeNull();
  });

  describe('how it is drawn', () => {
    const states = (
      [
        ['r0c0', {}, 'never'],
        ['r0c1', { queriesRun: 2 }, 'searched'],
        ['r1c0', { queriesRun: 2, leads: 3 }, 'leads'],
        ['r1c1', { claimedByRunId: 'run-1' }, 'claimed'],
        ['r2c0', { queriesRun: 9, exhaustedAt: '2026-10-17T10:00:00.000Z' }, 'saturated'],
      ] as const
    ).map(([cellKey, over, state], i) => ({
      state,
      cell: {
        ...cell,
        regionCellId: `c${i}`,
        cellKey,
        queriesRun: 0,
        leads: 0,
        placesFound: 0,
        newPlacesFound: 0,
        exhaustedAt: null,
        claimedByRunId: null,
        ...over,
      } satisfies CellSummary,
    }));

    function drawn() {
      return render(
        <I18nProvider>
          <CoverageMap
            regions={regions}
            exploredIds={explored}
            regionId="sfax"
            onRegionChange={vi.fn()}
            cells={states.map((s) => s.cell)}
          />
        </I18nProvider>,
      );
    }

    it('cuts the search squares to the region outline, so nothing is drawn outside it', () => {
      const { container } = drawn();
      const group = container.querySelector('g.map-cells')!;
      const clip = /^url\(#(.+)\)$/.exec(group.getAttribute('clip-path') ?? '')?.[1];
      expect(clip).toBeTruthy();
      const path = container.querySelector(`clipPath[id="${clip}"] path`)!;
      // The clip is the outline of the picked region, the same path the region is drawn with.
      const sfax = container.querySelector('path.region-shape.is-selected')!;
      expect(path.getAttribute('d')).toBe(sfax.getAttribute('d'));
      // Every square is inside that group, none loose in the svg.
      expect(group.querySelectorAll('rect.map-cell')).toHaveLength(5);
      expect(container.querySelectorAll('svg > rect')).toHaveLength(0);
    });

    it('gives each square its state as a class, and never a fill of its own colour attribute', () => {
      const { container } = drawn();
      for (const { state, cell: c } of states) {
        const rect = container.querySelector(`rect[aria-label^="Cell ${c.cellKey},"]`)!;
        expect(rect).toHaveClass('map-cell', `cell-${state}`);
        // Colour comes from the stylesheet by state; an inline or attribute fill would be dark.
        expect(rect.getAttribute('fill')).toBeNull();
        expect(rect.getAttribute('style')).toBeNull();
      }
    });

    it('draws no frame: nothing but the region shape carries the focus, and no frame shape exists', () => {
      const { container } = drawn();
      expect(container.querySelectorAll('svg rect:not(.map-cell)')).toHaveLength(0);
      expect(container.querySelector('svg [stroke]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Region Sfax' })).toHaveClass('is-selected');
    });

    it('credits the boundary data in the corner of the map', () => {
      drawn();
      expect(screen.getByText(/geoBoundaries.*OpenStreetMap contributors.*ODbL/)).toBeVisible();
    });
  });

  it('shows a message when there is nothing to draw', () => {
    render(
      <I18nProvider>
        <CoverageMap
          regions={[]}
          exploredIds={new Set()}
          regionId={null}
          onRegionChange={vi.fn()}
          cells={null}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('No region has a map outline yet.')).toBeVisible();
  });
});

describe('CoverageMap credit', () => {
  const frRegion: RegionGeometry = {
    country: 'FR',
    regionId: 'fr-bretagne',
    name: 'Brittany',
    bounds: { south: 47.3, west: -5.2, north: 48.9, east: -1.0 },
    outline: square(-5.2, 47.3, -1.0, 48.9),
    outlineSource: 'osm',
  };
  const show = (list: RegionGeometry[]) =>
    render(
      <I18nProvider>
        <CoverageMap
          regions={list}
          exploredIds={new Set()}
          regionId={null}
          onRegionChange={() => undefined}
          cells={null}
        />
      </I18nProvider>,
    );

  it('credits the source of the country that is drawn, not Tunisia’s', () => {
    show([frRegion]);
    expect(screen.getByText(/IGN \(Etalab Open Licence 2\.0\)/)).toBeInTheDocument();
    expect(screen.queryByText(/ODbL/)).not.toBeInTheDocument();
  });

  it('keeps the OpenStreetMap credit for Tunisia', () => {
    show([regions[0]!]);
    expect(screen.getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument();
  });
});
