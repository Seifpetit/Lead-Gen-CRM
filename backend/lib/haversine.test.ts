import { describe, expect, it } from 'vitest';
import { haversineKm } from './geo.js';

const tunis = { lat: 36.8065, lng: 10.1815 };
const sfax = { lat: 34.7406, lng: 10.7603 };

describe('haversineKm', () => {
  it('is zero for the same point and the same both ways', () => {
    expect(haversineKm(tunis, tunis)).toBe(0);
    expect(haversineKm(tunis, sfax)).toBeCloseTo(haversineKm(sfax, tunis), 9);
  });

  it('measures Tunis to Sfax at about 240 km', () => {
    const km = haversineKm(tunis, sfax);
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(250);
  });

  it('measures one degree of latitude as about 111 km and half the globe as about 20,015 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015.09, 0);
  });
});
