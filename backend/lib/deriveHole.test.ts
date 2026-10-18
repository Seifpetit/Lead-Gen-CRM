import { describe, expect, it } from 'vitest';
import outlinesFile from '../config/regionOutlines.json' with { type: 'json' };
import { REGION_BOUNDS } from '../config/regionBounds.js';
import { DeriveError, deriveEnclosedRegion } from './deriveHole.js';
import { pointInOutline, type Outline, type Position } from './geo.js';
import { MANOUBA_NOTE, renderBoundsFile, renderOutlinesFile } from './regionFiles.js';

// Fake neighbours (invented rectangles, not real governorates) around a hole at the Manouba point.

const POINT = { lat: 36.81, lng: 10.0 };
const rect = (west: number, south: number, east: number, north: number): Outline => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

/** Four neighbours around a hole of `w` x `h` degrees centred on the point; `gap` opens a seam. */
function ring(w: number, h: number, gap = 0): Outline[] {
  const { lat, lng } = POINT;
  const [W, E, S, N] = [lng - w / 2, lng + w / 2, lat - h / 2, lat + h / 2];
  const reach = 0.25;
  return [
    rect(W - reach, N, E + reach, N + reach), // north, overlapping the corners
    rect(W - reach, S - reach, E + reach, S), // south
    rect(E, S - gap, E + reach, N + gap), // east: meets north and south unless gap > 0
    rect(W - reach, S - gap, W, N + gap), // west
  ];
}

describe('deriveEnclosedRegion', () => {
  it('returns the hole the neighbours leave, with the bounding box of that hole', () => {
    const r = deriveEnclosedRegion(ring(0.2, 0.15), POINT);
    expect(r.outline.type).toBe('Polygon');
    expect(r.bounds.west).toBeCloseTo(9.9, 2);
    expect(r.bounds.east).toBeCloseTo(10.1, 2);
    expect(r.bounds.south).toBeCloseTo(36.735, 2);
    expect(r.bounds.north).toBeCloseTo(36.885, 2);
    // 0.2 x 0.15 degrees at this latitude.
    expect(r.areaKm2).toBeGreaterThan(280);
    expect(r.areaKm2).toBeLessThan(320);
    expect(pointInOutline(POINT.lat, POINT.lng, r.outline)).toBe(true);
    expect(pointInOutline(36.95, 10.0, r.outline)).toBe(false);
    expect(pointInOutline(POINT.lat, 10.15, r.outline)).toBe(false);
  });

  it('writes a closed ring', () => {
    const r = deriveEnclosedRegion(ring(0.2, 0.15), POINT);
    const shell = r.outline.coordinates[0] as Position[];
    expect(shell[0]).toEqual(shell[shell.length - 1]);
    expect(shell.length).toBeGreaterThanOrEqual(4);
  });

  it('ignores small holes elsewhere, such as a lake', () => {
    const lake: Outline = {
      type: 'Polygon',
      coordinates: [
        (rect(9.5, 37.2, 9.8, 37.5).coordinates as Position[][])[0]!,
        // a 0.06 x 0.05 degree hole in the land, far from the point
        [
          [9.6, 37.3],
          [9.66, 37.3],
          [9.66, 37.35],
          [9.6, 37.35],
          [9.6, 37.3],
        ],
      ],
    };
    const r = deriveEnclosedRegion([...ring(0.2, 0.15), lake], POINT);
    expect(r.bounds.north).toBeCloseTo(36.885, 2);
    expect(r.bounds.west).toBeCloseTo(9.9, 2);
  });

  it('treats a thin seam between neighbours as closed', () => {
    // The east and west neighbours stop 0.003 degrees short of the north and south ones.
    const r = deriveEnclosedRegion(ring(0.2, 0.15, -0.003), POINT);
    expect(r.areaKm2).toBeGreaterThan(280);
    expect(r.areaKm2).toBeLessThan(330);
  });

  it('fails, writing nothing, when the gap is open to the outside', () => {
    const open = ring(0.2, 0.15).slice(0, 3); // no west neighbour
    expect(() => deriveEnclosedRegion(open, POINT)).toThrow(/not enclosed/);
  });

  it('fails when the point lies inside a neighbour', () => {
    expect(() => deriveEnclosedRegion([rect(9.5, 36.5, 10.5, 37.1)], POINT)).toThrow(
      /lies inside a neighbouring outline/,
    );
  });

  it('fails when there is no hole at all', () => {
    expect(() => deriveEnclosedRegion([], POINT)).toThrow(DeriveError);
  });

  it('fails with the area when the hole is under 100 km2', () => {
    expect(() => deriveEnclosedRegion(ring(0.1, 0.08), POINT)).toThrow(
      /\d+ km2, outside the accepted 100 to 2000 km2/,
    );
  });

  it('fails with the area when the hole is over 2,000 km2', () => {
    expect(() => deriveEnclosedRegion(ring(0.6, 0.4), POINT)).toThrow(
      /\d+ km2, outside the accepted 100 to 2000 km2/,
    );
  });
});

describe('committed Manouba geometry', () => {
  const outline = (outlinesFile.outlines as unknown as Record<string, Outline>).manouba!;

  it('is the derived outline, containing the Manouba point, with a box that matches', () => {
    expect(pointInOutline(POINT.lat, POINT.lng, outline)).toBe(true);
    const b = REGION_BOUNDS.manouba!;
    expect(b.south).toBeLessThan(POINT.lat);
    expect(b.north).toBeGreaterThan(POINT.lat);
    expect(b.west).toBeLessThan(POINT.lng);
    expect(b.east).toBeGreaterThan(POINT.lng);
    const derived = (outlinesFile as unknown as { derived: Record<string, { areaKm2: number }> })
      .derived.manouba!;
    expect(derived.areaKm2).toBeGreaterThanOrEqual(100);
    expect(derived.areaKm2).toBeLessThanOrEqual(2000);
  });
});

describe('region files', () => {
  it('records the derivation note in both files', () => {
    const files = {
      fetchedAt: '2026-10-18',
      toleranceDeg: 0.002,
      bounds: { manouba: { south: 36.5, west: 9.5, north: 37, east: 10.1 } },
      outlines: { manouba: rect(9.5, 36.5, 10.1, 37) },
      derived: { manouba: { note: MANOUBA_NOTE, areaKm2: 1139, derivedAt: '2026-10-18' } },
    };
    expect(JSON.parse(renderOutlinesFile(files)).derived.manouba.note).toBe(MANOUBA_NOTE);
    expect(renderBoundsFile(files)).toContain('manouba: derived from the neighbouring');
    expect(renderOutlinesFile({ ...files, derived: {} })).not.toContain('derived');
  });
});
