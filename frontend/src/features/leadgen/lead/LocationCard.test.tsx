import type { RegionGeometry } from '@lead-gen-crm/shared';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { company } from '../../../test/fixtures.js';
import { fakeServer } from '../../../test/fakeServer.js';
import { renderWith } from '../../../test/render.js';
import { googleMapsLink, LocationCard } from './LocationCard.js';

// Leaflet needs a real layout; here it is replaced by a recorder of what it is asked to draw.
const calls = vi.hoisted(() => ({
  map: [] as { center: [number, number]; zoom: number }[],
  tiles: [] as { url: string; attribution: string }[],
  markers: [] as [number, number][],
  removed: 0,
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const chain = { addTo: () => chain };
  const L = {
    map: (_el: HTMLElement, o: { center: [number, number]; zoom: number }) => {
      calls.map.push({ center: o.center, zoom: o.zoom });
      return { remove: () => void calls.removed++ };
    },
    tileLayer: (url: string, o: { attribution: string }) => {
      calls.tiles.push({ url, attribution: o.attribution });
      return chain;
    },
    divIcon: () => ({}),
    marker: (at: [number, number]) => {
      calls.markers.push(at);
      return chain;
    },
  };
  return { default: L, ...L };
});

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
const REGIONS: RegionGeometry[] = [
  {
    regionId: 'sfax',
    name: 'Sfax',
    bounds: { south: 34, west: 10, north: 35, east: 11 },
    outline: square(10, 34, 11, 35),
    outlineSource: 'osm',
  },
  {
    regionId: 'tunis',
    name: 'Tunis',
    bounds: { south: 36, west: 10, north: 37, east: 11 },
    outline: square(10, 36, 11, 37),
    outlineSource: 'osm',
  },
];

function view(over: Parameters<typeof company>[0] = {}) {
  const server = fakeServer({ 'GET /api/regions/geometry': { items: REGIONS } });
  const c = company({ governorate: 'sfax', ...over });
  renderWith(<LocationCard company={c} />, server);
  return c;
}

beforeEach(() => {
  calls.map.length = 0;
  calls.tiles.length = 0;
  calls.markers.length = 0;
  calls.removed = 0;
});

describe('Location card with coordinates', () => {
  it('lights the company region on Tunisia and pins its coordinates', async () => {
    view({ location: { lat: 34.74, lng: 10.76 }, city: 'Sfax' });
    const mini = await screen.findByRole('img', {
      name: 'Map of Tunisia with Sfax highlighted and a pin where the business is',
    });
    expect(mini.querySelector('[data-region="sfax"]')).toHaveClass('is-picked');
    expect(mini.querySelector('[data-region="tunis"]')).not.toHaveClass('is-picked');
    expect(mini.querySelector('.mini-pin')).not.toBeNull();
    // The city is the region's own name here, so it is not said twice.
    expect(screen.queryByText('Sfax, Sfax')).toBeNull();
  });

  it('names the city next to the region when they differ', async () => {
    view({ location: { lat: 34.8, lng: 10.7 }, city: 'Sakiet Ezzit' });
    expect(await screen.findByText('Sakiet Ezzit, Sfax')).toBeVisible();
  });

  it('shows an OpenStreetMap map on the business, with its credit, and a Google Maps link', async () => {
    const c = view({ location: { lat: 34.74, lng: 10.76 }, googlePlaceId: 'place-1' });
    await waitFor(() => expect(calls.markers).toEqual([[34.74, 10.76]]));
    expect(calls.map[0]).toMatchObject({ center: [34.74, 10.76] });
    expect(calls.tiles[0]!.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    // The licence needs the credit, linked to the copyright page.
    expect(calls.tiles[0]!.attribution).toContain('OpenStreetMap');
    expect(calls.tiles[0]!.attribution).toContain('https://www.openstreetmap.org/copyright');
    const link = screen.getByRole('link', { name: /Open in Google Maps/ });
    expect(link.getAttribute('href')).toBe(googleMapsLink(c));
    expect(link.getAttribute('href')).toContain('query=34.74%2C10.76');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('region', { name: 'Map of Fixture Transport SARL' })).toBeVisible();
  });

  it('takes the map down when the card goes away', async () => {
    const server = fakeServer({ 'GET /api/regions/geometry': { items: REGIONS } });
    const { unmount } = renderWith(
      <LocationCard company={company({ governorate: 'sfax', location: { lat: 1, lng: 2 } })} />,
      server,
    );
    await waitFor(() => expect(calls.map).toHaveLength(1));
    unmount();
    expect(calls.removed).toBe(1);
  });
});

describe('Location card without coordinates', () => {
  it('still lights the region and says the exact place is unknown, with no pin or map', async () => {
    view({ location: null, city: null });
    const mini = await screen.findByRole('img', { name: 'Map of Tunisia with Sfax highlighted' });
    expect(mini.querySelector('[data-region="sfax"]')).toHaveClass('is-picked');
    expect(mini.querySelector('.mini-pin')).toBeNull();
    expect(screen.getByText('Exact location unknown')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Google Maps/ })).toBeNull();
    expect(calls.map).toHaveLength(0);
  });
});

describe('googleMapsLink', () => {
  it('is null without coordinates and carries the place id when there is one', () => {
    expect(googleMapsLink({ location: null, googlePlaceId: 'p' })).toBeNull();
    const url = new URL(googleMapsLink({ location: { lat: 1.5, lng: -2.5 }, googlePlaceId: 'p' })!);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('query')).toBe('1.5,-2.5');
    expect(url.searchParams.get('query_place_id')).toBe('p');
  });
});
