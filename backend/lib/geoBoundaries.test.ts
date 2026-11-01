import { describe, expect, it } from 'vitest';
import {
  GOVERNORATE_BY_ISO,
  buildCountryGeometries,
  buildRegionGeometries,
} from './geoBoundaries.js';
import { FRANCE } from '../config/countryRegions.js';

const square = (x: number, y: number) => [
  [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
    [x, y],
  ],
];
const feature = (iso: string, geometry: unknown) => ({
  properties: { shapeISO: iso, shapeName: iso },
  geometry: geometry as { type: string; coordinates: unknown },
});
const all = Object.keys(GOVERNORATE_BY_ISO).map((iso, i) =>
  feature(iso, { type: 'Polygon', coordinates: square(i, 30) }),
);

describe('buildRegionGeometries', () => {
  it('builds one outline and one box per governorate, keyed by region id', () => {
    const g = buildRegionGeometries({ features: all });
    expect(Object.keys(g.outlines)).toHaveLength(24);
    expect(g.bounds.tunis).toEqual({ south: 30, west: 0, north: 31, east: 1 });
    expect(g.outlines.kef!.type).toBe('Polygon');
  });

  it('rounds to 6 decimals, drops repeated points, closes open rings, keeps holes and islands', () => {
    const features = [
      ...all.slice(1),
      feature('TN-11', {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0.12345678, 0],
              [0.12345678, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            [
              [0.2, 0.2],
              [0.4, 0.2],
              [0.4, 0.4],
              [0.2, 0.2],
            ],
          ],
          square(5, 5),
        ],
      }),
    ];
    const t = buildRegionGeometries({ features }).outlines.tunis!;
    expect(t.type).toBe('MultiPolygon');
    if (t.type !== 'MultiPolygon') return;
    expect(t.coordinates[0]![0]).toEqual([
      [0.123457, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.123457, 0],
    ]);
    expect(t.coordinates[0]).toHaveLength(2);
    expect(t.coordinates).toHaveLength(2);
  });

  it('refuses a file with a missing, duplicate or unknown governorate', () => {
    expect(() => buildRegionGeometries({ features: all.slice(1) })).toThrow(/Missing.*tunis/);
    expect(() => buildRegionGeometries({ features: [...all, all[0]!] })).toThrow(/twice/);
    expect(() => buildRegionGeometries({ features: [...all, feature('TN-99', null)] })).toThrow(
      /Unknown governorate/,
    );
  });
});

describe('buildCountryGeometries', () => {
  const frFeatures = FRANCE.regions.map((r, i) => ({
    properties: { shapeName: r.shapeName },
    geometry: { type: 'Polygon', coordinates: square(i, 40) } as {
      type: string;
      coordinates: unknown;
    },
  }));

  it('builds one outline and one box per region of the country, keyed by its namespaced id', () => {
    const g = buildCountryGeometries({ features: frFeatures }, FRANCE);
    expect(Object.keys(g.outlines)).toHaveLength(13);
    expect(g.bounds['fr-bretagne']).toBeDefined();
  });

  it('stops on a region it does not know, a duplicate and a missing one', () => {
    const unknown = [...frFeatures, { ...frFeatures[0]!, properties: { shapeName: 'Atlantis' } }];
    expect(() => buildCountryGeometries({ features: unknown }, FRANCE)).toThrow(/Atlantis/);
    expect(() =>
      buildCountryGeometries({ features: [...frFeatures, frFeatures[0]!] }, FRANCE),
    ).toThrow(/twice/);
    expect(() => buildCountryGeometries({ features: frFeatures.slice(1) }, FRANCE)).toThrow(
      /Missing/,
    );
  });
});
