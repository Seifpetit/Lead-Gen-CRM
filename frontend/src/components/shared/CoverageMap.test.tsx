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
  { regionId: 'manouba', name: 'Manouba', bounds: null, outline: null, outlineSource: null },
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
  const onPlanCell = vi.fn();
  const view = (id: string | null) => (
    <I18nProvider>
      <CoverageMap
        regions={regions}
        exploredIds={explored}
        regionId={id}
        onRegionChange={onRegionChange}
        cells={id ? [cell] : null}
        onPlanCell={onPlanCell}
      />
    </I18nProvider>
  );
  const utils = render(view(regionId));
  return {
    onRegionChange,
    onPlanCell,
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

  it('shows a cell’s numbers and plans a run for it', async () => {
    const { onPlanCell, user } = setup('sfax');
    await user.click(screen.getByRole('button', { name: /r0c0/ }));
    expect(screen.getByRole('region', { name: 'Cell r0c0' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Plan a run in this cell' }));
    expect(onPlanCell).toHaveBeenCalledWith('sfax', 'r0c0');
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
          onPlanCell={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('No region has a map outline yet.')).toBeVisible();
  });
});
