import { describe, expect, it } from 'vitest';
import {
  boundsIntersectOutline,
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
