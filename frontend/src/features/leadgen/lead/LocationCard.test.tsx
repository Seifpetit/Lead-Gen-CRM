import type { RegionGeometry } from '@lead-gen-crm/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  icons: [] as { iconSize: [number, number] }[],
  fitted: [] as [number, number][][],
  removed: 0,
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const chain = { addTo: () => chain };
  const L = {
    map: (_el: HTMLElement, o: { center: [number, number]; zoom: number }) => {
      calls.map.push({ center: o.center, zoom: o.zoom });
      return {
        remove: () => void calls.removed++,
        fitBounds: (b: { corners: [number, number][] }) => void calls.fitted.push(b.corners),
      };
    },
    tileLayer: (url: string, o: { attribution: string }) => {
      calls.tiles.push({ url, attribution: o.attribution });
      return chain;
    },
    latLngBounds: (a: [number, number], b: [number, number]) => {
      const bounds = { corners: [a, b], extend: (p: [number, number]) => bounds.corners.push(p) };
      return bounds;
    },
    divIcon: (o: { iconSize: [number, number] }) => {
      calls.icons.push(o);
      return {};
    },
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

/** A located business in Sfax (or the given region id) with the given address. */
function render(address: string | null, governorate = 'sfax') {
  const server = fakeServer({ 'GET /api/regions/geometry': { items: REGIONS } });
  return renderWith(
    <LocationCard
      company={company({ governorate, address, location: { lat: 34.74, lng: 10.76 } })}
    />,
    server,
  );
}

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
  calls.icons.length = 0;
  calls.fitted.length = 0;
  calls.removed = 0;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Location card with coordinates', () => {
  it('has no map of the whole country, and does not say the city twice', async () => {
    view({ location: { lat: 34.74, lng: 10.76 }, city: 'Sfax' });
    await waitFor(() => expect(calls.map).toHaveLength(1));
    expect(screen.queryByRole('img', { name: /Map of Tunisia/ })).toBeNull();
    expect(screen.queryByText('Sfax, Sfax')).toBeNull();
  });

  it('shows the whole region from above, with the pin kept at its usual size', async () => {
    view({ location: { lat: 34.74, lng: 10.76 } });
    // The region's box (34-35 N, 10-11 E) is what the map fits, and the pin is inside it.
    await waitFor(() => expect(calls.fitted).toHaveLength(1));
    expect(calls.fitted[0]).toEqual([
      [34, 10],
      [35, 11],
      [34.74, 10.76],
    ]);
    expect(calls.icons[0]!.iconSize).toEqual([26, 26]);
  });

  it('puts the region and the address on one line, above the map', async () => {
    const { container } = render('Route de Tunis km 3, 3000 Sfax');
    const line = await screen.findByText('Sfax, Route de Tunis km 3, 3000 Sfax');
    expect(line).toBeVisible();
    const map = await screen.findByRole('region', { name: /^Map of / });
    expect(line.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('.location-place')).toHaveLength(1);
  });

  it('has one Google Maps link, the drive button, and none of the repeats', async () => {
    render('Route de Tunis km 3');
    await screen.findByText('Sfax, Route de Tunis km 3');
    expect(screen.getAllByRole('link', { name: /Google Maps/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add your address to see the drive by car' }),
    ).toBeVisible();
    expect(screen.queryByText(/Address:/)).toBeNull();
    expect(screen.queryByText(/Google Maps place/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Location' })).toBeNull();
    expect(screen.queryByText(/^Region:/)).toBeNull();
  });

  it('shows only the region when there is no address, and only the address when there is no region', async () => {
    const onlyRegion = render(null);
    expect(await screen.findByText('Sfax')).toBeVisible();
    onlyRegion.unmount();
    const onlyAddress = render('Route de Tunis km 3', '');
    expect(await screen.findByText('Route de Tunis km 3')).toBeVisible();
    expect(screen.queryByText(/^Sfax,/)).toBeNull();
    onlyAddress.unmount();
    const neither = render(null, '');
    await screen.findByRole('region', { name: /^Map of / });
    expect(neither.container.querySelector('.location-place')).toBeNull();
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
  it('says the exact place is unknown, still shows region and address, and draws no map', async () => {
    view({ location: null, city: null, address: 'Zone industrielle' });
    expect(await screen.findByText('Exact location unknown')).toBeVisible();
    expect(screen.getByText('Sfax, Zone industrielle')).toBeVisible();
    expect(screen.queryByText(/Address:/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Google Maps/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add your address/ })).toBeNull();
    expect(calls.map).toHaveLength(0);
  });
});

/** The map services, answered by a stand-in: the address is found, then the road measured. */
function stubServices(over: { place?: unknown; route?: unknown } = {}) {
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('nominatim')
      ? (over.place ?? [{ lat: '36.8', lon: '10.18' }])
      : (over.route ?? { routes: [{ distance: 187_400, duration: 7_800 }] });
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('Drive time by car', () => {
  const business = { location: { lat: 34.74, lng: 10.76 } };

  it('asks for the address, then says how long the drive takes, and remembers the address', async () => {
    const f = stubServices();
    const user = userEvent.setup();
    view(business);
    await user.click(
      await screen.findByRole('button', { name: 'Add your address to see the drive by car' }),
    );
    await user.type(screen.getByLabelText('Your address'), 'Avenue Habib Bourguiba, Tunis');
    await user.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(
      await screen.findByText(
        'About 2 h 10 min by car (187 km) from Avenue Habib Bourguiba, Tunis',
      ),
    ).toBeVisible();
    expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem('leadgen.myAddress')!)).toMatchObject({
      text: 'Avenue Habib Bourguiba, Tunis',
      lat: 36.8,
      lng: 10.18,
    });
  });

  it('measures straight away when the address is already known, and lets it be changed', async () => {
    window.localStorage.setItem(
      'leadgen.myAddress',
      JSON.stringify({ text: 'Tunis', lat: 36.8, lng: 10.18 }),
    );
    const f = stubServices();
    const user = userEvent.setup();
    view(business);
    expect(await screen.findByText('About 2 h 10 min by car (187 km) from Tunis')).toBeVisible();
    // Only the route was asked for: the address was not looked up again.
    expect(f).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Change address' }));
    expect(screen.getByLabelText('Your address')).toHaveValue('Tunis');
  });

  it('says so when the address is not found, and offers the drive in Google Maps', async () => {
    stubServices({ place: [] });
    const user = userEvent.setup();
    view(business);
    await user.click(await screen.findByRole('button', { name: /Add your address/ }));
    await user.type(screen.getByLabelText('Your address'), 'nowhere');
    await user.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That address was not found');
    expect(screen.getByRole('link', { name: /Open the drive in Google Maps/ })).toHaveAttribute(
      'href',
      expect.stringContaining('travelmode=driving'),
    );
    expect(window.localStorage.getItem('leadgen.myAddress')).toBeNull();
  });

  it('says so when the map service cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    const user = userEvent.setup();
    view(business);
    await user.click(await screen.findByRole('button', { name: /Add your address/ }));
    await user.type(screen.getByLabelText('Your address'), 'Tunis');
    await user.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be reached');
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
