import type { CellSummary, MapOutline } from '@lead-gen-crm/shared';

// Drawing Tunisia without map tiles: longitude/latitude are projected onto a flat plane with
// longitude squeezed by cos(latitude), which is accurate enough at the scale of a country.

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Viewport {
  /** SVG viewBox "x y width height". */
  viewBox: string;
  width: number;
  height: number;
}

const SCALE = 100; // plane units per degree of latitude: keeps path numbers readable

export function makeProjection(bounds: LatLngBounds) {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat) * SCALE;
  return {
    x: (lng: number) => round((lng - bounds.west) * kx),
    y: (lat: number) => round((bounds.north - lat) * SCALE),
    width: round((bounds.east - bounds.west) * kx),
    height: round((bounds.north - bounds.south) * SCALE),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export type Projection = ReturnType<typeof makeProjection>;

/** SVG path data for an outline's polygons; holes use the even-odd fill rule. */
export function outlinePath(outline: MapOutline, p: Projection): string {
  const polygons = (outline.type === 'Polygon' ? [outline.coordinates] : outline.coordinates) as [
    number,
    number,
  ][][][];
  return polygons
    .flatMap((rings) =>
      rings.map(
        (ring) =>
          ring.map(([lng, lat], i) => `${i === 0 ? 'M' : 'L'}${p.x(lng)} ${p.y(lat)}`).join('') +
          'Z',
      ),
    )
    .join('');
}

export function unionBounds(list: readonly LatLngBounds[]): LatLngBounds | null {
  if (list.length === 0) return null;
  return {
    south: Math.min(...list.map((b) => b.south)),
    west: Math.min(...list.map((b) => b.west)),
    north: Math.max(...list.map((b) => b.north)),
    east: Math.max(...list.map((b) => b.east)),
  };
}

/** Adds a margin (a fraction of the larger side) around bounds. */
export function padBounds(b: LatLngBounds, fraction = 0.06): LatLngBounds {
  const pad = Math.max(b.north - b.south, b.east - b.west) * fraction;
  return { south: b.south - pad, west: b.west - pad, north: b.north + pad, east: b.east + pad };
}

export type CellState = 'never' | 'claimed' | 'searched' | 'leads' | 'saturated';

/**
 * What a cell looks like on the map. Order matters: a cell a run holds right now is yellow
 * whatever its history; saturated beats leads beats searched.
 */
export function cellState(
  c: Pick<CellSummary, 'claimedByRunId' | 'exhaustedAt' | 'leads' | 'queriesRun'>,
): CellState {
  if (c.claimedByRunId) return 'claimed';
  if (c.exhaustedAt) return 'saturated';
  if (c.leads > 0) return 'leads';
  if (c.queriesRun > 0) return 'searched';
  return 'never';
}
