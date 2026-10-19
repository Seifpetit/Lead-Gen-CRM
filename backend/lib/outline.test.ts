import { describe, expect, it } from 'vitest';
import {
  boundsIntersectOutline,
  cellOverlap,
  MIN_CELL_OVERLAP,
  outlineBounds,
  outlineFromBounds,
  placeInOutline,
  pointInOutline,
  simplifyOutline,
  type Outline,
} from './geo.js';

// A triangle with its right angle at the south-west: (10,34) (12,34) (10,36), as [lng, lat].
const TRIANGLE: Outline = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 34],
      [12, 34],
      [10, 36],
      [10, 34],
    ],
  ],
};
const ISLANDS: Outline = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
    [
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
        [5, 5],
      ],
    ],
  ],
};

describe('pointInOutline / placeInOutline', () => {
  it('knows inside from outside, including a hole and a second island', () => {
    expect(pointInOutline(34.5, 10.5, TRIANGLE)).toBe(true);
    expect(pointInOutline(35.5, 11.5, TRIANGLE)).toBe(false); // beyond the hypotenuse
    expect(pointInOutline(5.5, 5.5, ISLANDS)).toBe(true);
    expect(pointInOutline(3, 3, ISLANDS)).toBe(false);
    const donut: Outline = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    expect(pointInOutline(5, 5, donut)).toBe(false);
    expect(pointInOutline(2, 2, donut)).toBe(true);
  });

  it('forgives a place within ~500 m of the simplified edge, not one clearly outside', () => {
    expect(placeInOutline(35.5, 10.5 + 0.002, TRIANGLE)).toBe(true);
    expect(placeInOutline(35.5, 10.5 + 0.2, TRIANGLE)).toBe(false);
  });
});

describe('boundsIntersectOutline (border cells)', () => {
  const cell = (south: number, west: number, north: number, east: number) => ({
    south,
    west,
    north,
    east,
  });

  it('keeps a cell fully inside, a cell crossing the border, and a cell containing the outline', () => {
    expect(boundsIntersectOutline(cell(34.1, 10.1, 34.3, 10.3), TRIANGLE)).toBe(true);
    // Straddles the hypotenuse: some corners in, some out.
    expect(boundsIntersectOutline(cell(34.9, 10.9, 35.3, 11.3), TRIANGLE)).toBe(true);
    expect(boundsIntersectOutline(cell(33, 9, 37, 13), TRIANGLE)).toBe(true);
  });

  it('keeps a cell the border crosses even with no corner inside either shape', () => {
    // A thin cell that cuts through the middle of the triangle: its corners are all outside
    // the triangle and no triangle vertex lies in it.
    expect(boundsIntersectOutline(cell(34.9, 9, 35.0, 13), TRIANGLE)).toBe(true);
  });

  it('drops a cell that only lies in the bounding box, beyond the hypotenuse', () => {
    expect(boundsIntersectOutline(cell(35.5, 11.5, 35.9, 11.9), TRIANGLE)).toBe(false);
    expect(boundsIntersectOutline(cell(0, 2, 1, 3), ISLANDS)).toBe(false);
    expect(boundsIntersectOutline(cell(5.2, 5.2, 5.4, 5.4), ISLANDS)).toBe(true);
  });
});

describe('helpers', () => {
  it('builds an outline from bounds and bounds from an outline', () => {
    const b = { south: 1, west: 2, north: 3, east: 4 };
    expect(outlineBounds(outlineFromBounds(b))).toEqual(b);
    expect(outlineBounds(ISLANDS)).toEqual({ south: 0, west: 0, north: 6, east: 6 });
  });

  it('simplifies a dense edge to its corners and keeps rings closed', () => {
    const dense: Outline = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0.0001],
          [2, 0],
          [3, 0.0001],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };
    const out = simplifyOutline(dense, 0.01);
    expect(out.type).toBe('Polygon');
    const ring = out.coordinates[0] as [number, number][];
    expect(ring).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ]);
  });
});

describe('cellOverlap', () => {
  const square = (s: number, w: number, n: number, e: number) => ({
    south: s,
    west: w,
    north: n,
    east: e,
  });
  const BOX: Outline = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
    ],
  };

  it('is 1 for a cell fully inside and 0 for one fully outside', () => {
    expect(cellOverlap(square(1, 1, 2, 2), BOX)).toBeCloseTo(1, 9);
    expect(cellOverlap(square(5, 5, 6, 6), BOX)).toBe(0);
  });

  it('is the share of the cell inside: half, and a cell larger than the outline', () => {
    expect(cellOverlap(square(3, 1, 5, 2), BOX)).toBeCloseTo(0.5, 9);
    expect(cellOverlap(square(-2, -2, 6, 6), BOX)).toBeCloseTo(16 / 64, 9);
  });

  it('cuts a cell along a slanted edge', () => {
    // The hypotenuse is lng + lat = 46: cell 34..35 x 10..11 is whole, 35..36 x 10..11 is half,
    // 35..36 x 11..12 is outside.
    expect(cellOverlap({ south: 34, west: 10, north: 35, east: 11 }, TRIANGLE)).toBeCloseTo(1, 9);
    expect(cellOverlap({ south: 35, west: 10, north: 36, east: 11 }, TRIANGLE)).toBeCloseTo(0.5, 9);
    expect(cellOverlap({ south: 35, west: 11, north: 36, east: 12 }, TRIANGLE)).toBeCloseTo(0, 9);
  });

  it('subtracts a hole', () => {
    const donut: Outline = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ],
    };
    expect(cellOverlap(square(0, 0, 4, 4), donut)).toBeCloseTo(12 / 16, 9);
    expect(cellOverlap(square(1, 1, 3, 3), donut)).toBe(0);
  });

  it('adds up several islands', () => {
    expect(cellOverlap(square(0, 0, 6, 6), ISLANDS)).toBeCloseTo(2 / 36, 9);
    expect(cellOverlap(square(5, 5, 6, 6), ISLANDS)).toBeCloseTo(1, 9);
  });

  it('is 0 for a cell with no area, and the minimum is about a tenth', () => {
    expect(cellOverlap(square(1, 1, 1, 2), BOX)).toBe(0);
    expect(MIN_CELL_OVERLAP).toBeCloseTo(0.1, 9);
  });
});
