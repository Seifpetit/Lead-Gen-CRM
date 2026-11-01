import type { MapPin, RegionGeometry } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { dashboardRoutes, page, preview, region } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { CoveragePage } from './CoveragePage.js';

// jsdom cannot draw a Leaflet map: the page is tested against a stand-in that reports what it was
// told and clicks like the real one.
vi.mock('./worldmap/WorldMap.js', async () => ({
  WorldMap: (await import('../../test/fakeWorldMap.js')).FakeWorldMap,
}));

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
const shape = (
  country: 'TN' | 'FR',
  regionId: string,
  name: string,
  box: [number, number, number, number],
): RegionGeometry => ({
  country,
  regionId,
  name,
  bounds: { west: box[0], south: box[1], east: box[2], north: box[3] },
  outline: square(...box),
  outlineSource: 'osm',
});
const geometry = (country: string) => ({
  items:
    country === 'FR'
      ? [shape('FR', 'fr-bretagne', 'Bretagne', [-5, 47.5, -1, 49])]
      : [
          shape('TN', 'sfax', 'Sfax', [10.2, 34.5, 11, 35.2]),
          shape('TN', 'tunis', 'Tunis', [10, 36.7, 10.3, 36.9]),
        ],
});

const summaries = [
  region({ regionId: 'sfax', name: 'Sfax', country: 'TN', coverage: 0.5, leads: 4, spendUsd: 1.5 }),
  region({
    regionId: 'tunis',
    name: 'Tunis',
    country: 'TN',
    coverage: 0.2,
    leads: 1,
    spendUsd: 0.5,
  }),
  region({
    regionId: 'fr-bretagne',
    name: 'Bretagne',
    country: 'FR',
    coverage: 0.1,
    leads: 2,
    spendUsd: 2,
  }),
];

const pin = (over: Partial<MapPin> = {}): MapPin => ({
  companyId: 'c1',
  name: 'Huilerie Baccar',
  lat: 34.7,
  lng: 10.7,
  country: 'TN',
  regionId: 'sfax',
  sector: 'olive-oil',
  tradeRole: 'exporter',
  category: 'Olive oil producer',
  city: 'Sfax',
  phone: '+21674123456',
  website: 'https://www.baccar.example',
  stage: 'found',
  score: 71,
  runId: 'run-1',
  leadId: 'lead-1',
  ...over,
});
const pins = [
  pin(),
  pin({ companyId: 'c2', name: 'Sans Lead', runId: null, leadId: null, score: null }),
];

function routes(over: Record<string, unknown> = {}) {
  return {
    ...dashboardRoutes(),
    'GET /api/map/pins': { body: { items: pins, total: pins.length } },
    'GET /api/regions': { body: page(summaries) },
    'GET /api/regions/geometry': (req: { query: URLSearchParams }) => ({
      body: geometry(req.query.get('country') ?? 'TN'),
    }),
    ...over,
  } as Parameters<typeof fakeServer>[0];
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}
function renderPage(server = fakeServer(routes()), route = '/leadgen/coverage') {
  renderWith(
    <>
      <Routes>
        <Route path="/leadgen/coverage" element={<CoveragePage />} />
        <Route path="/leadgen/runs/:runId/leads/:leadId" element={<p>Lead page</p>} />
      </Routes>
      <Where />
    </>,
    server,
    route,
  );
  return server;
}
const map = () => screen.getByTestId('world-map');

describe('Coverage world map', () => {
  it('shows the whole world first, with every company as a pin and the region panel closed', async () => {
    const server = renderPage();
    expect(await screen.findByRole('heading', { name: 'Coverage', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(map()).toHaveAttribute('data-pins', '2'));
    expect(map()).toHaveAttribute('data-country', '');
    expect(map()).toHaveAttribute('data-supported', 'TN,FR');
    // Pins and regions of every country, asked for at once.
    expect(server.to('GET /api/map/pins')[0]!.query.get('country')).toBeNull();
    const head = screen.getByRole('button', { name: /Coverage by region/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: /regions/i })).toBeNull();
  });

  it('opens the totals of every country when the closed panel is clicked', async () => {
    renderPage();
    await waitFor(() => expect(map()).toHaveAttribute('data-pins', '2'));
    await userEvent.click(screen.getByRole('button', { name: /Coverage by region/ }));
    expect(screen.getByRole('button', { name: /^Tunisia/ })).toBeEnabled();
    const off = screen.getByRole('button', { name: /^Germany/ });
    expect(off).toBeDisabled();
    expect(off).toHaveTextContent('Switched off');
    expect(screen.getByText('Companies').nextElementSibling).toHaveTextContent('2');
  });

  it('moves to a country picked in the picker and opens the region panel by itself', async () => {
    const server = renderPage();
    await waitFor(() => expect(map()).toHaveAttribute('data-pins', '2'));
    await userEvent.click(screen.getByRole('button', { name: /Country: All countries/ }));
    const menu = screen.getByRole('list', { name: 'Country' });
    await userEvent.click(within(menu).getByRole('button', { name: /^France/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('?focus=FR');
    await waitFor(() => expect(map()).toHaveAttribute('data-country', 'FR'));
    await waitFor(() => expect(map()).toHaveAttribute('data-regions', 'fr-bretagne'));
    expect(server.to('GET /api/regions/geometry').at(-1)!.query.get('country')).toBe('FR');
    expect(screen.getByRole('button', { name: /Coverage by region: France/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Bretagne/ })).toBeEnabled();
  });

  it('moves to a supported country clicked on the map, and ignores a click on the same one', async () => {
    renderPage();
    await waitFor(() => expect(map()).toHaveAttribute('data-pins', '2'));
    await userEvent.click(screen.getByRole('button', { name: 'map country TN' }));
    await waitFor(() => expect(map()).toHaveAttribute('data-country', 'TN'));
    expect(screen.getByRole('button', { name: /Coverage by region: Tunisia/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'map country TN' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/leadgen/coverage?focus=TN');
  });

  it('lets a person collapse the panel of a picked country and open it again', async () => {
    renderPage(undefined, '/leadgen/coverage?focus=TN');
    const head = await screen.findByRole('button', { name: /Coverage by region: Tunisia/ });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
  });

  it('ignores a country that is switched off or unknown in the address', async () => {
    renderPage(undefined, '/leadgen/coverage?focus=DE');
    await waitFor(() => expect(map()).toHaveAttribute('data-pins', '2'));
    expect(map()).toHaveAttribute('data-country', '');
  });

  it('lights a region on the map from its row, and the row from the region', async () => {
    renderPage(undefined, '/leadgen/coverage?focus=TN');
    const row = await screen.findByRole('button', { name: /^Sfax/ });
    await userEvent.hover(row);
    expect(map()).toHaveAttribute('data-hover-region', 'sfax');
    await userEvent.unhover(row);
    expect(map()).toHaveAttribute('data-hover-region', '');
    await userEvent.hover(await screen.findByRole('button', { name: 'map region Tunis' }));
    expect(map()).toHaveAttribute('data-hover-region', 'tunis');
    expect(screen.getByRole('button', { name: /^Tunis/, pressed: false })).toHaveClass('is-hot');
  });

  it('picks a region by its row or on the map, shows its details, and unpicks it', async () => {
    renderPage(undefined, '/leadgen/coverage?focus=TN');
    await userEvent.click(await screen.findByRole('button', { name: /^Sfax/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('?focus=TN&region=sfax');
    expect(map()).toHaveAttribute('data-selected-region', 'sfax');
    expect(screen.getByRole('heading', { name: 'Sfax', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a run in Sfax' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'map region Tunis' }));
    expect(map()).toHaveAttribute('data-selected-region', 'tunis');
    // Empty map: the region is let go, the country stays.
    await userEvent.click(screen.getByRole('button', { name: 'map background' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/leadgen/coverage?focus=TN');
    expect(map()).toHaveAttribute('data-selected-region', '');
  });

  it('opens a small panel over a pin, with a button to the lead page', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'map pin Huilerie Baccar' }));
    const panel = screen.getByRole('region', { name: 'Details of Huilerie Baccar' });
    expect(within(panel).getByRole('heading', { name: 'Huilerie Baccar' })).toBeInTheDocument();
    expect(within(panel).getByText('Sfax · Olive oil producer')).toBeInTheDocument();
    expect(within(panel).getByText('Score 71')).toBeInTheDocument();
    expect(within(panel).getByText('baccar.example')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('link', { name: 'Open the lead' }));
    expect(await screen.findByText('Lead page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/leadgen/runs/run-1/leads/lead-1');
  });

  it('says so, with no button, when the company was never scored', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'map pin Sans Lead' }));
    const panel = screen.getByRole('region', { name: 'Details of Sans Lead' });
    expect(within(panel).queryByRole('link', { name: 'Open the lead' })).toBeNull();
    expect(within(panel).getByText(/no lead page/)).toBeInTheDocument();
  });

  it('closes the pin panel from its button and from the map', async () => {
    renderPage();
    const open = async () =>
      userEvent.click(await screen.findByRole('button', { name: 'map pin Huilerie Baccar' }));
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Close the company details' }));
    expect(screen.queryByRole('region', { name: /Details of/ })).toBeNull();

    await open();
    await userEvent.click(screen.getByRole('button', { name: 'map background' }));
    expect(screen.queryByRole('region', { name: /Details of/ })).toBeNull();
  });

  it('steps back with Escape: the open pin, then the picked region, then the picked country', async () => {
    renderPage(undefined, '/leadgen/coverage?focus=TN&region=sfax');
    await userEvent.click(await screen.findByRole('button', { name: 'map pin Huilerie Baccar' }));
    await waitFor(() => expect(map()).toHaveAttribute('data-selected-region', 'sfax'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /Details of/ })).toBeNull();
    expect(map()).toHaveAttribute('data-selected-region', 'sfax');
    await userEvent.keyboard('{Escape}');
    expect(map()).toHaveAttribute('data-selected-region', '');
    expect(map()).toHaveAttribute('data-country', 'TN');
    await userEvent.keyboard('{Escape}');
    expect(map()).toHaveAttribute('data-country', '');
  });

  it('starts a run in a region of the picked country, whatever the sidebar says', async () => {
    window.localStorage.setItem('leadgen.gdpr.accepted', '1');
    const server = renderPage(
      fakeServer(
        routes({
          'POST /api/runs/preview': { body: preview({ regionId: 'fr-bretagne' }) },
        }),
      ),
      '/leadgen/coverage?focus=FR&region=fr-bretagne',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start a run in Bretagne' }));
    expect(await screen.findByRole('dialog', { name: 'Start a run' })).toBeInTheDocument();
    // The window's own region list asks for France, not for the sidebar's country.
    await waitFor(() => {
      const asked = server.to('GET /api/regions').map((c) => c.query.get('country'));
      expect(asked).toContain('FR');
    });
  });

  it('shows the data-protection notice once before the first run in a European country', async () => {
    window.localStorage.removeItem('leadgen.gdpr.accepted');
    renderPage(
      fakeServer(
        routes({ 'POST /api/runs/preview': { body: preview({ regionId: 'fr-bretagne' }) } }),
      ),
      '/leadgen/coverage?focus=FR&region=fr-bretagne',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start a run in Bretagne' }));
    const notice = await screen.findByRole('dialog', { name: 'Before you search in France' });
    expect(screen.queryByRole('dialog', { name: 'Start a run' })).toBeNull();
    await userEvent.click(within(notice).getByRole('button', { name: 'I understand' }));
    expect(await screen.findByRole('dialog', { name: 'Start a run' })).toBeInTheDocument();
    expect(window.localStorage.getItem('leadgen.gdpr.accepted')).toBe('1');
  });

  it('shows a retry when the lists cannot be loaded', async () => {
    renderPage(
      fakeServer(routes({ 'GET /api/map/pins': { status: 500, body: { error: 'boom' } } })),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so when no company has a place yet', async () => {
    renderPage(fakeServer(routes({ 'GET /api/map/pins': { body: { items: [], total: 0 } } })));
    expect(await screen.findByText(/No company has a place on the map yet/)).toBeInTheDocument();
  });
});
