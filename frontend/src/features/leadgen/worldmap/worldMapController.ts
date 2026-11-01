import type { CountryCode, MapOutline, MapPin, RegionGeometry } from '@lead-gen-crm/shared';
import type * as Leaflet from 'leaflet';
import { mainBounds, type LatLngBox } from './geoBounds.js';
import { pinColor, WORLD, WORLD_VIEW } from './worldStyle.js';

/** What a region is like, for its colour. */
export type RegionTone = 'none' | 'active' | 'saturated';

export interface WorldCountry {
  code: string;
  name: string;
  geometry: MapOutline;
}

export interface MapEvents {
  /** A supported country was clicked on the map. */
  onCountry: (code: CountryCode) => void;
  /** Empty map, ocean or an unsupported country was clicked. */
  onBackground: () => void;
  onRegionHover: (regionId: string | null) => void;
  onRegionClick: (regionId: string) => void;
  onPinClick: (pin: MapPin) => void;
  /** Where the open pin is on screen now (map container pixels), or null when none is open. */
  onAnchor: (point: { x: number; y: number } | null) => void;
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The Leaflet side of the world map, kept out of React: the country shapes, the regions of the
 * picked country, the pins and the camera. React tells it what to show; it tells React what the
 * person clicked or hovered through MapEvents.
 */
export function createWorldMap(
  L: typeof Leaflet,
  host: HTMLElement,
  world: readonly WorldCountry[],
  events: () => MapEvents,
) {
  const map = L.map(host, {
    center: WORLD_VIEW.center,
    zoom: WORLD_VIEW.zoom,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0.25,
    worldCopyJump: false,
    maxBounds: [
      [-70, -200],
      [85, 200],
    ],
    maxBoundsViscosity: 0.8,
    scrollWheelZoom: true,
  });
  host.style.backgroundColor = WORLD.ocean;
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.createPane('regions').style.zIndex = '420';
  map.createPane('pins').style.zIndex = '450';

  // ---- countries
  let supported = new Set<string>();
  let picked: string | null = null;
  const countryLayers = new Map<string, Leaflet.GeoJSON>();
  const boxes = new Map<string, LatLngBox>();
  const countryStyle = (code: string, hover = false): Leaflet.PathOptions => ({
    fillColor:
      code === picked
        ? WORLD.selected
        : supported.has(code)
          ? hover
            ? WORLD.supportedHover
            : WORLD.supported
          : WORLD.unsupported,
    fillOpacity: 1,
    color: WORLD.line,
    weight: code === picked ? 1.8 : 0.7,
  });
  for (const c of world) {
    const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry: c.geometry } as never, {
      style: () => countryStyle(c.code),
      bubblingMouseEvents: false,
    }).addTo(map);
    layer.bindTooltip(c.name, { sticky: true, className: 'wm-tip', direction: 'top' });
    layer.on(
      'mouseover',
      () => supported.has(c.code) && layer.setStyle(countryStyle(c.code, true)),
    );
    layer.on('mouseout', () => layer.setStyle(countryStyle(c.code)));
    layer.on('click', () => {
      if (supported.has(c.code)) events().onCountry(c.code as CountryCode);
      else events().onBackground();
    });
    countryLayers.set(c.code, layer);
    boxes.set(c.code, mainBounds(c.geometry));
  }
  const restyleCountries = () => {
    for (const [code, layer] of countryLayers) {
      layer.setStyle(countryStyle(code));
      // The dark countries do nothing when clicked, so they keep the dragging hand.
      layer.eachLayer((shape) => {
        const el = (shape as Leaflet.Path).getElement?.();
        el?.classList.toggle('wm-off', !supported.has(code));
      });
    }
  };

  // ---- regions of the picked country
  const regionsGroup = L.layerGroup().addTo(map);
  const regionLayers = new Map<string, Leaflet.GeoJSON>();
  let tones = new Map<string, RegionTone>();
  let hoverRegion: string | null = null;
  let pickedRegion: string | null = null;
  const regionStyle = (id: string): Leaflet.PathOptions => {
    const tone = tones.get(id) ?? 'none';
    const hot = id === hoverRegion;
    return {
      fillColor: hot
        ? WORLD.regionHover
        : tone === 'saturated'
          ? WORLD.regionSaturated
          : tone === 'active'
            ? WORLD.regionActive
            : WORLD.regionNone,
      fillOpacity: 0.92,
      color: WORLD.line,
      weight: hot || id === pickedRegion ? 2.6 : 1,
      dashArray: tone === 'none' && !hot ? '4 3' : undefined,
    } as Leaflet.PathOptions;
  };
  const restyleRegions = () => {
    for (const [id, layer] of regionLayers) {
      layer.setStyle(regionStyle(id));
      if (id === hoverRegion || id === pickedRegion) layer.bringToFront();
    }
  };

  // ---- pins
  let pins: MapPin[] = [];
  const pinLayers = new Map<string, Leaflet.CircleMarker>();
  const pinsGroup = L.layerGroup().addTo(map);
  const ring = L.circleMarker([0, 0], {
    pane: 'pins',
    radius: 14,
    fill: false,
    color: WORLD.line,
    weight: 3,
    interactive: false,
  });
  let openPin: MapPin | null = null;
  const BASE = { radius: 6, weight: 1.6 };
  const styleOf = (p: MapPin, hot: boolean): Leaflet.CircleMarkerOptions => ({
    radius: hot ? 10 : BASE.radius,
    weight: hot ? 3 : BASE.weight,
    color: WORLD.line,
    fillColor: pinColor(p),
    fillOpacity: 1,
  });

  const anchor = () => {
    if (!openPin) return events().onAnchor(null);
    const pt = map.latLngToContainerPoint([openPin.lat, openPin.lng]);
    events().onAnchor({ x: pt.x, y: pt.y });
  };
  map.on('move zoom resize', anchor);
  map.on('click', () => events().onBackground());

  // Room the floating panels take, so a country is centred in the part of the map left free.
  let insets = { top: 72, left: 48, right: 48, bottom: 48 };

  function fly(box: LatLngBox | null) {
    const duration = reducedMotion() ? 0 : 1.2;
    if (!box) {
      if (duration === 0) map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom, { animate: false });
      else map.flyTo(WORLD_VIEW.center, WORLD_VIEW.zoom, { duration });
      return;
    }
    const bounds = L.latLngBounds([box.south, box.west], [box.north, box.east]);
    const options = {
      paddingTopLeft: L.point(insets.left, insets.top),
      paddingBottomRight: L.point(insets.right, insets.bottom),
      maxZoom: 8,
    };
    if (duration === 0) map.fitBounds(bounds, { ...options, animate: false });
    else map.flyToBounds(bounds, { ...options, duration });
  }

  return {
    map,

    setSupported(codes: readonly string[]) {
      supported = new Set(codes);
      restyleCountries();
    },

    /** Picks a country: highlights it and flies there; null flies back out to the world. */
    pickCountry(code: string | null) {
      picked = code;
      restyleCountries();
      fly(code === null ? null : (boxes.get(code) ?? null));
    },

    /** How much of each edge the floating panels cover, in pixels. */
    setInsets(next: { top: number; left: number; right: number; bottom: number }) {
      insets = next;
    },

    setRegions(items: readonly RegionGeometry[], toneOf: Map<string, RegionTone>) {
      regionsGroup.clearLayers();
      regionLayers.clear();
      tones = toneOf;
      for (const r of items) {
        if (!r.outline) continue;
        const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry: r.outline } as never, {
          pane: 'regions',
          style: () => regionStyle(r.regionId),
          bubblingMouseEvents: false,
        });
        layer.bindTooltip(r.name, { sticky: true, className: 'wm-tip', direction: 'top' });
        layer.on('mouseover', () => events().onRegionHover(r.regionId));
        layer.on('mouseout', () => events().onRegionHover(null));
        layer.on('click', () => events().onRegionClick(r.regionId));
        regionsGroup.addLayer(layer);
        regionLayers.set(r.regionId, layer);
      }
    },

    highlightRegion(hover: string | null, selected: string | null) {
      hoverRegion = hover;
      pickedRegion = selected;
      restyleRegions();
    },

    flyToRegion(box: LatLngBox | null) {
      if (box) fly(box);
    },

    setPins(next: readonly MapPin[]) {
      pinsGroup.clearLayers();
      pinLayers.clear();
      pins = [...next];
      for (const p of pins) {
        const m = L.circleMarker([p.lat, p.lng], {
          pane: 'pins',
          bubblingMouseEvents: false,
          ...styleOf(p, false),
        });
        m.bindTooltip(p.name, { className: 'wm-tip', direction: 'top', offset: [0, -8] });
        m.on('mouseover', () => {
          m.setStyle(styleOf(p, true));
          m.bringToFront();
        });
        m.on('mouseout', () => m.setStyle(styleOf(p, p.companyId === openPin?.companyId)));
        m.on('click', () => events().onPinClick(p));
        pinsGroup.addLayer(m);
        pinLayers.set(p.companyId, m);
      }
    },

    openPin(id: string | null) {
      const old = openPin;
      openPin = id ? (pins.find((p) => p.companyId === id) ?? null) : null;
      if (old) pinLayers.get(old.companyId)?.setStyle(styleOf(old, false));
      if (openPin) {
        pinLayers.get(openPin.companyId)?.setStyle(styleOf(openPin, true));
        ring.setLatLng([openPin.lat, openPin.lng]);
        if (!map.hasLayer(ring)) ring.addTo(map);
        ring.bringToFront();
        // Keep the pin and its panel in view.
        if (!map.getBounds().pad(-0.15).contains([openPin.lat, openPin.lng])) {
          map.panTo([openPin.lat, openPin.lng], { animate: !reducedMotion() });
        }
      } else if (map.hasLayer(ring)) ring.remove();
      anchor();
    },

    invalidate: () => map.invalidateSize(),
    destroy: () => map.remove(),
  };
}

export type WorldMapController = ReturnType<typeof createWorldMap>;
