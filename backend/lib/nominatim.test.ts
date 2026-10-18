import { describe, expect, it } from 'vitest';
import { parseGovernorate, type NominatimResult } from './nominatim.js';

// A trimmed, synthetic response in Nominatim's jsonv2 shape (not a recording).
const sfax: NominatimResult = {
  osm_type: 'relation',
  osm_id: 1234,
  category: 'boundary',
  type: 'administrative',
  display_name: 'Sfax, Tunisia',
  boundingbox: ['34.0', '35.5', '10.0', '11.5'],
  geojson: {
    type: 'Polygon',
    coordinates: [
      [
        [10.0, 34.0],
        [10.5, 34.00001],
        [11.5, 34.0],
        [11.5, 35.5],
        [10.0, 35.5],
        [10.0, 34.0],
      ],
    ],
  },
};

describe('parseGovernorate', () => {
  it('takes the boundary relation, bounds in south/west/north/east order, simplified outline', () => {
    const g = parseGovernorate(
      [{ osm_type: 'node', category: 'place' }, sfax] as NominatimResult[],
      0.002,
    );
    expect(g.osmRef).toBe('relation/1234');
    expect(g.bounds).toEqual({ south: 34, west: 10, north: 35.5, east: 11.5 });
    expect(g.outline.coordinates[0]).toHaveLength(5);
  });

  it.each([
    ['no results', []],
    ['a point result', [{ osm_type: 'node', category: 'place', geojson: { type: 'Point' } }]],
    ['a boundary without a polygon', [{ ...sfax, geojson: undefined }]],
    ['a flat box', [{ ...sfax, boundingbox: ['34', '34', '10', '11'] }]],
  ] as [string, NominatimResult[]][])('refuses %s', (_name, results) => {
    expect(() => parseGovernorate(results, 0.002)).toThrow();
  });

  it('takes the admin_level 4 relation, not a town of the same name', () => {
    const town: NominatimResult = {
      ...sfax,
      osm_id: 1,
      boundingbox: ['34.5', '34.6', '10.5', '10.6'],
      extratags: { admin_level: '8' },
    };
    const governorate: NominatimResult = { ...sfax, osm_id: 2, extratags: { admin_level: '4' } };
    expect(parseGovernorate([town, governorate], 0.001).osmRef).toContain('2');
  });

  it('refuses a response whose boundaries are all below governorate level', () => {
    const town: NominatimResult = { ...sfax, extratags: { admin_level: '8' } };
    expect(() => parseGovernorate([town], 0.001)).toThrow(/no administrative boundary/);
  });
});
