import type { WorldMapProps } from '../features/leadgen/worldmap/WorldMap.js';

/**
 * A stand-in for the Leaflet map in tests (jsdom cannot draw one): it shows what the page told
 * it and gives buttons that do what a click or hover on the map would.
 */
export function FakeWorldMap(props: WorldMapProps) {
  return (
    <div
      data-testid="world-map"
      data-country={props.country ?? ''}
      data-selected-region={props.selectedRegion ?? ''}
      data-hover-region={props.hoverRegion ?? ''}
      data-supported={props.supported.join(',')}
      data-pins={props.pins.length}
      data-regions={props.regions.map((r) => r.regionId).join(',')}
    >
      {props.supported.map((code) => (
        <button key={code} type="button" onClick={() => props.onCountry(code as never)}>
          {`map country ${code}`}
        </button>
      ))}
      <button type="button" onClick={props.onBackground}>
        map background
      </button>
      {props.regions.map((r) => (
        <button
          key={r.regionId}
          type="button"
          onMouseEnter={() => props.onRegionHover(r.regionId)}
          onMouseLeave={() => props.onRegionHover(null)}
          onClick={() => props.onRegionClick(r.regionId)}
        >
          {`map region ${r.name}`}
        </button>
      ))}
      {props.pins.map((p) => (
        <button key={p.companyId} type="button" onClick={() => props.onPinClick(p)}>
          {`map pin ${p.name}`}
        </button>
      ))}
      {props.children}
      {props.pinPanel(props.openPinId ? { x: 300, y: 400 } : null, { width: 1000, height: 700 })}
    </div>
  );
}
