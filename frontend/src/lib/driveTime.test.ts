import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  driveBetween,
  formatDriveTime,
  geocodeAddress,
  googleDirectionsLink,
  loadMyAddress,
  saveMyAddress,
} from './driveTime.js';

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response);

beforeEach(() => window.localStorage.clear());

describe('formatDriveTime', () => {
  it.each([
    [0.2, '1 min'],
    [45.4, '45 min'],
    [60, '1 h'],
    [131, '2 h 10 min'],
    [128, '2 h 10 min'],
  ])('%s minutes is %s', (minutes, text) => expect(formatDriveTime(minutes)).toBe(text));
});

describe('geocodeAddress', () => {
  it('asks Nominatim for Tunisia and returns the first place', async () => {
    const f = reply([{ lat: '36.8', lon: '10.18' }]);
    expect(await geocodeAddress('Avenue Habib Bourguiba, Tunis', f)).toEqual({
      lat: 36.8,
      lng: 10.18,
    });
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('nominatim.openstreetmap.org');
    expect(url).toContain('countrycodes=tn');
  });
  it('returns null when nothing matches, and throws when the service is down', async () => {
    expect(await geocodeAddress('zzzz', reply([]))).toBeNull();
    await expect(geocodeAddress('x', reply({}, false))).rejects.toThrow();
  });
});

describe('driveBetween', () => {
  it('turns metres and seconds into km and minutes, longitude first in the request', async () => {
    const f = reply({ routes: [{ distance: 187_400, duration: 7_800 }] });
    const drive = await driveBetween({ lat: 36.8, lng: 10.18 }, { lat: 34.74, lng: 10.76 }, f);
    expect(drive).toEqual({ km: 187.4, minutes: 130 });
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('/10.18,36.8;10.76,34.74?');
  });
  it('returns null when there is no road route', async () => {
    expect(
      await driveBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, reply({ routes: [] })),
    ).toBeNull();
  });
});

describe('my address', () => {
  it('is kept in this browser and forgotten on request', () => {
    expect(loadMyAddress()).toBeNull();
    saveMyAddress({ text: 'Sfax', lat: 34.7, lng: 10.7 });
    expect(loadMyAddress()).toEqual({ text: 'Sfax', lat: 34.7, lng: 10.7 });
    saveMyAddress(null);
    expect(loadMyAddress()).toBeNull();
  });
  it('ignores a damaged value', () => {
    window.localStorage.setItem('leadgen.myAddress', '{"text":1}');
    expect(loadMyAddress()).toBeNull();
  });
});

it('links to Google Maps directions by car', () => {
  const link = googleDirectionsLink('Sfax', { lat: 36.8, lng: 10.18 });
  expect(link).toContain('travelmode=driving');
  expect(link).toContain('destination=36.8%2C10.18');
});
