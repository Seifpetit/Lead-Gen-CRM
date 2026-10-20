import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/index.js';

/** The OpenStreetMap tile server's address and the credit its licence requires. */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors';

/**
 * An OpenStreetMap map (Leaflet) centred on a point with a pin. Leaflet is loaded only when a map
 * is shown, so it stays out of the rest of the app. No API key, no screenshots stored: tiles are
 * fetched by the browser straight from OpenStreetMap.
 */
export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function OsmMap({
  lat,
  lng,
  zoom = 15,
  bounds,
  label,
}: {
  lat: number;
  lng: number;
  /** Used when no bounds are given. */
  zoom?: number;
  /** Show all of this area (and the pin) from above instead of a street-level close-up. */
  bounds?: MapBounds | null;
  /** What the pin is, for the screen reader. */
  label: string;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    void (async () => {
      const [{ default: L }] = await Promise.all([
        import('leaflet'),
        import('leaflet/dist/leaflet.css'),
      ]);
      if (cancelled || !host.current) return;
      map = L.map(host.current, { center: [lat, lng], zoom, scrollWheelZoom: false });
      if (bounds) {
        // The whole region from above, widened if the pin happens to lie outside it.
        const area = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
        area.extend([lat, lng]);
        map.fitBounds(area, { padding: [8, 8] });
      }
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      // A drawn pin, so no marker image has to be found by the bundler.
      const icon = L.divIcon({
        className: 'osm-pin',
        html: '<span class="osm-pin-dot" aria-hidden="true"></span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([lat, lng], { icon, title: label, keyboard: false }).addTo(map);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, zoom, label, bounds?.south, bounds?.west, bounds?.north, bounds?.east]);

  return (
    <div
      ref={host}
      className="osm-map"
      role="region"
      aria-label={t('location.osm.label', { name: label })}
    />
  );
}
