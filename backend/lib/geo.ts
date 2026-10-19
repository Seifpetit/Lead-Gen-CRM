// Map rectangles. Pure, no I/O.

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Splits bounds into a rows x cols grid, row 0 at the south edge. Pure. */
export function splitBounds(
  b: Bounds,
  rows: number,
  cols: number,
): { key: string; bounds: Bounds }[] {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new Error('rows and cols must be positive integers');
  }
  const dLat = (b.north - b.south) / rows;
  const dLng = (b.east - b.west) / cols;
  const cells: { key: string; bounds: Bounds }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        key: `r${r}c${c}`,
        bounds: {
          south: b.south + r * dLat,
          north: r === rows - 1 ? b.north : b.south + (r + 1) * dLat,
          west: b.west + c * dLng,
          east: c === cols - 1 ? b.east : b.west + (c + 1) * dLng,
        },
      });
    }
  }
  return cells;
}

// ---- Outlines (GeoJSON) -------------------------------------------------------------------

/** [lng, lat]. GeoJSON order. */
export type Position = [number, number];
/** A ring is closed (first position repeated last); the first ring is the shell, the rest holes. */
export type PolygonRings = Position[][];

/** A governorate outline: one polygon, or several (islands such as Kerkennah). */
export type Outline =
  | { type: 'Polygon'; coordinates: PolygonRings }
  | { type: 'MultiPolygon'; coordinates: PolygonRings[] };

const polygonsOf = (o: Outline): PolygonRings[] =>
  o.type === 'Polygon' ? [o.coordinates] : o.coordinates;

/** A place this close (in degrees, about 550 m) to an outline still counts as inside it. */
export const OUTLINE_TOLERANCE_DEG = 0.005;

/** Rectangle as an outline, for regions that have bounds but no stored outline. */
export function outlineFromBounds(b: Bounds): Outline {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [b.west, b.south],
        [b.east, b.south],
        [b.east, b.north],
        [b.west, b.north],
        [b.west, b.south],
      ],
    ],
  };
}

function inRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(lng: number, lat: number, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((lng - a[0]) * dx + (lat - a[1]) * dy) / len2));
  return Math.hypot(lng - (a[0] + t * dx), lat - (a[1] + t * dy));
}

function distToRings(lng: number, lat: number, rings: PolygonRings): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      best = Math.min(best, distToSegment(lng, lat, ring[i - 1]!, ring[i]!));
    }
  }
  return best;
}

/** Strictly inside the outline (holes excluded). Boundary points may go either way. */
export function pointInOutline(lat: number, lng: number, outline: Outline): boolean {
  return polygonsOf(outline).some(
    ([shell, ...holes]) =>
      shell !== undefined && inRing(lng, lat, shell) && !holes.some((h) => inRing(lng, lat, h)),
  );
}

/**
 * Inside the outline, or within `toleranceDeg` of its edge. The stored outline is simplified,
 * so a place on the coast or the border can sit a few hundred metres outside it.
 */
export function placeInOutline(
  lat: number,
  lng: number,
  outline: Outline,
  toleranceDeg = OUTLINE_TOLERANCE_DEG,
): boolean {
  if (pointInOutline(lat, lng, outline)) return true;
  return polygonsOf(outline).some((rings) => distToRings(lng, lat, rings) <= toleranceDeg);
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const o = (p: Position, q: Position, r: Position) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0;
}

/** True when the rectangle and the outline share any area (overlap, contain or touch). */
export function boundsIntersectOutline(b: Bounds, outline: Outline): boolean {
  const corners: Position[] = [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
  ];
  const edges: [Position, Position][] = corners.map((c, i) => [c, corners[(i + 1) % 4]!]);
  return polygonsOf(outline).some((rings) => {
    const shell = rings[0];
    if (!shell) return false;
    // A corner of the rectangle inside the outline.
    if (corners.some(([lng, lat]) => pointInOutline(lat, lng, outline))) return true;
    // A vertex of the outline inside the rectangle (outline within the cell).
    if (
      shell.some(([lng, lat]) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north)
    ) {
      return true;
    }
    // Edges crossing, with no corner or vertex inside on either side.
    for (let i = 1; i < shell.length; i++) {
      for (const [p, q] of edges) if (segmentsCross(shell[i - 1]!, shell[i]!, p, q)) return true;
    }
    return false;
  });
}

/** Signed area of a ring (shoelace), positive when counter-clockwise. Square degrees. */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    sum += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  }
  return sum / 2;
}

/** The ring cut to the rectangle (Sutherland-Hodgman: one edge of the rectangle at a time). */
function clipRingToBounds(ring: Position[], b: Bounds): Position[] {
  type Edge = { inside: (p: Position) => boolean; cut: (p: Position, q: Position) => Position };
  const atLng =
    (x: number) =>
    (p: Position, q: Position): Position => {
      const t = (x - p[0]) / (q[0] - p[0]);
      return [x, p[1] + t * (q[1] - p[1])];
    };
  const atLat =
    (y: number) =>
    (p: Position, q: Position): Position => {
      const t = (y - p[1]) / (q[1] - p[1]);
      return [p[0] + t * (q[0] - p[0]), y];
    };
  const edges: Edge[] = [
    { inside: (p) => p[0] >= b.west, cut: atLng(b.west) },
    { inside: (p) => p[0] <= b.east, cut: atLng(b.east) },
    { inside: (p) => p[1] >= b.south, cut: atLat(b.south) },
    { inside: (p) => p[1] <= b.north, cut: atLat(b.north) },
  ];
  let poly = ring.slice(0, -1);
  for (const edge of edges) {
    const next: Position[] = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i]!;
      const prev = poly[(i + poly.length - 1) % poly.length]!;
      if (edge.inside(cur)) {
        if (!edge.inside(prev)) next.push(edge.cut(prev, cur));
        next.push(cur);
      } else if (edge.inside(prev)) {
        next.push(edge.cut(prev, cur));
      }
    }
    poly = next;
    if (poly.length === 0) return [];
  }
  return [...poly, poly[0]!];
}

/**
 * The share (0 to 1) of a rectangle's area that lies inside the outline, holes excluded. Areas
 * are taken in degrees, which is faithful enough inside one cell (a few tens of km across).
 */
export function cellOverlap(b: Bounds, outline: Outline): number {
  const cell = (b.east - b.west) * (b.north - b.south);
  if (!(cell > 0)) return 0;
  let inside = 0;
  for (const [shell, ...holes] of polygonsOf(outline)) {
    if (!shell) continue;
    inside += Math.abs(ringArea(clipRingToBounds(shell, b)));
    for (const hole of holes) inside -= Math.abs(ringArea(clipRingToBounds(hole, b)));
  }
  return Math.min(1, Math.max(0, inside / cell));
}

/** A cell with less of its area inside the region than this is not searched. */
export const MIN_CELL_OVERLAP = 0.1;

/** Smallest rectangle around the outline. */
export function outlineBounds(outline: Outline): Bounds {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const rings of polygonsOf(outline)) {
    for (const [lng, lat] of rings[0] ?? []) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  if (!Number.isFinite(south)) throw new Error('Outline has no coordinates');
  return { south, west, north, east };
}

/** Douglas-Peucker on one ring; keeps the ring closed and at least 4 positions. */
export function simplifyRing(ring: Position[], toleranceDeg: number): Position[] {
  if (ring.length <= 4) return ring;
  const open = ring.slice(0, -1);
  const keep = new Array<boolean>(open.length).fill(false);
  keep[0] = true;
  keep[open.length - 1] = true;
  const walk = (lo: number, hi: number): void => {
    let far = -1;
    let farDist = toleranceDeg;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(open[i]![0], open[i]![1], open[lo]!, open[hi]!);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far !== -1) {
      keep[far] = true;
      walk(lo, far);
      walk(far, hi);
    }
  };
  walk(0, open.length - 1);
  const kept = open.filter((_, i) => keep[i]);
  return kept.length < 3 ? ring : [...kept, kept[0]!];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Simplifies every ring, drops holes and islands that collapse, rounds to about 1 m. */
export function simplifyOutline(outline: Outline, toleranceDeg: number): Outline {
  const polys = polygonsOf(outline)
    .map((rings) =>
      rings
        .map((r) => simplifyRing(r, toleranceDeg).map(([x, y]): Position => [round5(x), round5(y)]))
        .filter((r) => r.length >= 4),
    )
    .filter((rings) => rings.length > 0);
  if (polys.length === 0) throw new Error('Outline collapsed while simplifying');
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0]! }
    : { type: 'MultiPolygon', coordinates: polys };
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * The great-circle distance in kilometres between two points (haversine). Ready for a future
 * "distance from my address" line; nothing calls it yet.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
