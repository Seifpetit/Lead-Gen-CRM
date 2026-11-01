import type { MapOutline } from '@lead-gen-crm/shared';

export interface LatLngBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

type Ring = number[][];

function polygonsOf(outline: MapOutline): Ring[][] {
  return (outline.type === 'Polygon'
    ? [outline.coordinates]
    : outline.coordinates) as unknown as Ring[][];
}

function boxOf(ring: Ring): LatLngBox {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const [lng, lat] of ring) {
    if (lat! < south) south = lat!;
    if (lat! > north) north = lat!;
    if (lng! < west) west = lng!;
    if (lng! > east) east = lng!;
  }
  return { south, west, north, east };
}

const area = (b: LatLngBox) => (b.north - b.south) * (b.east - b.west);
const near = (a: LatLngBox, b: LatLngBox, pad: number) =>
  a.west - pad <= b.east &&
  a.east + pad >= b.west &&
  a.south - pad <= b.north &&
  a.north + pad >= b.south;

/**
 * The box to fly to for a country: its biggest piece and whatever lies within a few degrees of it
 * (Corsica next to mainland France), but not far overseas land (French Guiana, Svalbard), which
 * would make the camera show half the world.
 */
export function mainBounds(outline: MapOutline, padDeg = 4): LatLngBox {
  const boxes = polygonsOf(outline).map((rings) => boxOf(rings[0]!));
  const biggest = boxes.reduce((a, b) => (area(b) > area(a) ? b : a));
  const kept = boxes.filter((b) => b === biggest || near(biggest, b, padDeg));
  return {
    south: Math.min(...kept.map((b) => b.south)),
    west: Math.min(...kept.map((b) => b.west)),
    north: Math.max(...kept.map((b) => b.north)),
    east: Math.max(...kept.map((b) => b.east)),
  };
}
