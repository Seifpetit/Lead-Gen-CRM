import type { CountryCode, MapPin, RegionGeometry } from '@lead-gen-crm/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorState, LoadingState } from '../../../components/states.js';
import { useT } from '../../../i18n/index.js';
import {
  createWorldMap,
  type MapEvents,
  type RegionTone,
  type WorldCountry,
  type WorldMapController,
} from './worldMapController.js';

export interface WorldMapProps {
  /** Countries the app can work in: the lighter grey, clickable. */
  supported: readonly string[];
  /** The country the camera is on; null shows the whole world. */
  country: CountryCode | null;
  /** The regions of that country, drawn on the map. */
  regions: readonly RegionGeometry[];
  tones: Map<string, RegionTone>;
  hoverRegion: string | null;
  selectedRegion: string | null;
  pins: readonly MapPin[];
  openPinId: string | null;
  onCountry: (code: CountryCode) => void;
  onBackground: () => void;
  onRegionHover: (regionId: string | null) => void;
  onRegionClick: (regionId: string) => void;
  onPinClick: (pin: MapPin) => void;
  /** The panel for the open pin, given where the pin is on screen and the size of the map. */
  pinPanel: (
    at: { x: number; y: number } | null,
    size: { width: number; height: number },
  ) => ReactNode;
  /** Floating pieces over the map (the country picker, the region panel). */
  children?: ReactNode;
}

/**
 * The world map: draggable and zoomable, with no tiles. Leaflet and the country shapes are loaded
 * only when this page is opened. The drawing lives in worldMapController; this component keeps it
 * in step with the props and passes clicks and hovers back up.
 */
export function WorldMap(props: WorldMapProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [ctl, setCtl] = useState<WorldMapController | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let made: WorldMapController | null = null;
    let watcher: ResizeObserver | null = null;
    setLoad('loading');
    void (async () => {
      try {
        const [{ default: L }, world] = await Promise.all([
          import('leaflet'),
          import('./worldCountries.json'),
          import('leaflet/dist/leaflet.css'),
        ]);
        if (cancelled || !host.current) return;
        const element = host.current;
        const events = (): MapEvents => ({
          onCountry: (code) => latest.current.onCountry(code),
          onBackground: () => latest.current.onBackground(),
          onRegionHover: (id) => latest.current.onRegionHover(id),
          onRegionClick: (id) => latest.current.onRegionClick(id),
          onPinClick: (pin) => latest.current.onPinClick(pin),
          onAnchor: setAnchor,
        });
        made = createWorldMap(
          L,
          element,
          (world as unknown as { countries: WorldCountry[] }).countries,
          events,
        );
        // Lets the browser tests work out where a place is on screen; nothing in the app reads it.
        Object.assign(element, { __worldMap: made });
        const measure = () => {
          setSize({ width: element.clientWidth, height: element.clientHeight });
          made?.invalidate();
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
          watcher = new ResizeObserver(measure);
          watcher.observe(element);
        }
        setCtl(made);
        setLoad('ready');
      } catch {
        if (!cancelled) setLoad('error');
      }
    })();
    return () => {
      cancelled = true;
      watcher?.disconnect();
      made?.destroy();
      setCtl(null);
    };
  }, [attempt]);

  const { supported, country, regions, tones, hoverRegion, selectedRegion, pins, openPinId } =
    props;

  useEffect(() => ctl?.setSupported(supported), [ctl, supported]);

  // The region panel floats over the left side (or the bottom on a narrow map): fly to what is left.
  const wide = size.width >= 760;
  useEffect(() => {
    ctl?.setInsets({
      top: 72,
      left: wide ? 392 : 24,
      right: 48,
      bottom: wide ? 48 : Math.round(size.height * 0.45),
    });
  }, [ctl, wide, size.height]);

  // The camera: the picked country, a picked region inside it, or back out to the world.
  const wasRegion = useRef<string | null>(null);
  useEffect(() => ctl?.pickCountry(country), [ctl, country]);
  useEffect(
    () => ctl?.setRegions(country === null ? [] : regions, tones),
    [ctl, country, regions, tones],
  );
  useEffect(() => {
    if (!ctl) return;
    const own = selectedRegion ? regions.find((r) => r.regionId === selectedRegion) : undefined;
    if (own?.bounds) ctl.flyToRegion(own.bounds);
    else if (wasRegion.current !== null && selectedRegion === null) ctl.pickCountry(country);
    wasRegion.current = selectedRegion;
    // The camera follows the pick, not the later reloads of the same regions.
  }, [ctl, selectedRegion]);
  useEffect(
    () => ctl?.highlightRegion(hoverRegion, selectedRegion),
    [ctl, hoverRegion, selectedRegion, regions, tones],
  );

  useEffect(() => ctl?.setPins(pins), [ctl, pins]);
  useEffect(() => ctl?.openPin(openPinId), [ctl, pins, openPinId]);

  return (
    <div className="wm-stage">
      <div
        ref={host}
        className="wm-host"
        role="region"
        aria-label={t('wm.map.label')}
        data-ready={load === 'ready' ? 'true' : 'false'}
      />
      {load === 'loading' && (
        <div className="wm-state">
          <LoadingState label={t('map.loading')} />
        </div>
      )}
      {load === 'error' && (
        <div className="wm-state">
          <ErrorState error={new Error('map')} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      )}
      <div className="wm-overlay">
        {props.children}
        {props.pinPanel(anchor, size)}
      </div>
    </div>
  );
}
