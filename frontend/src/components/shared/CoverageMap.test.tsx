import type { CellSummary, RegionGeometry } from '@lead-gen-crm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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

function Harness({ onPick }: { onPick: (p: unknown) => void }) {
  const [regionId, setRegionId] = useState<string | null>(null);
  return (
    <I18nProvider>
      <CoverageMap
        regions={regions}
        regionId={regionId}
        onRegionChange={setRegionId}
        cells={regionId ? [cell] : null}
        onPick={onPick}
      />
    </I18nProvider>
  );
}

describe('CoverageMap', () => {
  it('draws a shape per outlined region and names the ones it cannot draw', () => {
    render(<Harness onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Sfax/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tunis/ })).toBeInTheDocument();
    expect(screen.getByText(/Manouba/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Colour key' })).toBeInTheDocument();
  });

  it('zooms to a region and hands a clicked cell to onPick', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Sfax/ }));
    await user.click(await screen.findByRole('button', { name: /r0c0/ }));
    expect(onPick).toHaveBeenCalledWith({ regionId: 'sfax', cellKeys: ['r0c0'] });
    expect(screen.getByRole('region', { name: /r0c0/ })).toBeVisible();
  });

  it('shows a message when there is nothing to draw', () => {
    render(
      <I18nProvider>
        <CoverageMap
          regions={[]}
          regionId={null}
          onRegionChange={vi.fn()}
          cells={null}
          onPick={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('No region has a map outline yet.')).toBeVisible();
  });
});
