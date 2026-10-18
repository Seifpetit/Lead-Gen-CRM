import { outlineBounds, simplifyRing, type Bounds, type Outline, type Position } from './geo.js';

// Derives a region's outline from the gap its neighbours leave. Used for a governorate that
// OpenStreetMap has no boundary polygon for (La Manouba): it sits wholly inside its neighbours,
// so the hole in the union of their outlines is its outline.
//
// The union is rasterised on a fine grid around the point (no polygon-clipping library): cells
// covered by any neighbour are filled, thin seams between neighbours are closed, the free space
// reachable from the window edge is "outside", and the free component holding the point is the
// hole. Pure, no I/O.

export class DeriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeriveError';
  }
}

export interface DerivedRegion {
  outline: Outline;
  bounds: Bounds;
  areaKm2: number;
}

export interface DeriveOptions {
  /** Raster cell, in degrees (0.002 is about 200 m). */
  cellDeg?: number;
  /** Half-size of the window around the point, in degrees. The hole must close inside it. */
  windowDeg?: number;
  /** Seams between neighbours up to 2 x this many cells wide are treated as closed. */
  sealCells?: number;
  minKm2?: number;
  maxKm2?: number;
  /** Douglas-Peucker tolerance for the staircase edge of the raster, in degrees. */
  simplifyDeg?: number;
}

const KM_PER_DEG = 111.32;

const polygonsOf = (o: Outline): Position[][][] =>
  o.type === 'Polygon' ? [o.coordinates] : o.coordinates;

/** Marks every cell whose centre lies inside the polygon (shell minus holes, even-odd). */
function fillPolygon(
  rings: Position[][],
  mask: Uint8Array,
  rows: number,
  cols: number,
  west: number,
  south: number,
  cell: number,
): void {
  const edges: [number, number, number, number][] = [];
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[i + 1]!;
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  const covered = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const y = south + (r + 0.5) * cell;
    const xs: number[] = [];
    for (const [x1, y1, x2, y2] of edges) {
      if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k]! - west) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1]! - west) / cell - 0.5));
      for (let c = c0; c <= c1; c++) covered[r * cols + c] = 1;
    }
  }
  // Each polygon is filled on its own, so one governorate's hole never cancels another's land.
  for (let i = 0; i < covered.length; i++) if (covered[i]) mask[i] = 1;
}

/** Cells within `radius` cells (square neighbourhood) of a set cell, optionally only where allowed. */
function grow(
  src: Uint8Array,
  rows: number,
  cols: number,
  radius: number,
  allowed?: Uint8Array,
): Uint8Array {
  let cur = src;
  for (let step = 0; step < radius; step++) {
    const next = Uint8Array.from(cur);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!cur[r * cols + c]) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            const i = rr * cols + cc;
            if (!allowed || allowed[i]) next[i] = 1;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

/** 4-connected free cells reachable from the start cells. */
function flood(free: Uint8Array, rows: number, cols: number, starts: number[]): Uint8Array {
  const seen = new Uint8Array(rows * cols);
  const stack = starts.filter((i) => free[i] && !seen[i]);
  for (const i of stack) seen[i] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const around = [
      r > 0 ? i - cols : -1,
      r < rows - 1 ? i + cols : -1,
      c > 0 ? i - 1 : -1,
      c < cols - 1 ? i + 1 : -1,
    ];
    for (const j of around) {
      if (j >= 0 && free[j] && !seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

/** Outer boundary of a set of cells as a closed ring of [lng, lat] corners. */
function outerRing(
  mask: Uint8Array,
  rows: number,
  cols: number,
  west: number,
  south: number,
  cell: number,
): Position[] {
  const inside = (r: number, c: number): boolean =>
    r >= 0 && c >= 0 && r < rows && c < cols && mask[r * cols + c] === 1;
  // Directed edges between lattice corners (cx, cy), with the region on the left.
  const next = new Map<string, [number, number][]>();
  const add = (x1: number, y1: number, x2: number, y2: number): void => {
    const k = `${x1},${y1}`;
    next.set(k, [...(next.get(k) ?? []), [x2, y2]]);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!inside(r, c)) continue;
      if (!inside(r - 1, c)) add(c, r, c + 1, r); // south side, heading east
      if (!inside(r, c + 1)) add(c + 1, r, c + 1, r + 1); // east side, heading north
      if (!inside(r + 1, c)) add(c + 1, r + 1, c, r + 1); // north side, heading west
      if (!inside(r, c - 1)) add(c, r + 1, c, r); // west side, heading south
    }
  }
  const rings: [number, number][][] = [];
  const used = new Set<string>();
  for (const [startKey, outs] of next) {
    for (const first of outs) {
      const edgeKey = `${startKey}>${first[0]},${first[1]}`;
      if (used.has(edgeKey)) continue;
      const ring: [number, number][] = [];
      let [x, y] = startKey.split(',').map(Number) as [number, number];
      let to = first;
      for (;;) {
        used.add(`${x},${y}>${to[0]},${to[1]}`);
        ring.push([x, y]);
        const dx = to[0] - x;
        const dy = to[1] - y;
        [x, y] = to;
        const options = (next.get(`${x},${y}`) ?? []).filter(
          (o) => !used.has(`${x},${y}>${o[0]},${o[1]}`),
        );
        if (options.length === 0) break;
        // At a corner where two cells only touch diagonally, keep to the same shape: turn left.
        options.sort(
          (a, b) => cross(dx, dy, b[0] - x, b[1] - y) - cross(dx, dy, a[0] - x, a[1] - y),
        );
        to = options[0]!;
      }
      rings.push(ring);
    }
  }
  const area = (ring: [number, number][]): number => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[(i + 1) % ring.length]!;
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  };
  // The outer boundary runs counter-clockwise (positive area) and is the biggest.
  const outer = rings.filter((r) => area(r) > 0).sort((a, b) => area(b) - area(a))[0];
  if (!outer) throw new DeriveError('could not trace the hole boundary');
  const ring = outer.map(([cx, cy]): Position => [west + cx * cell, south + cy * cell]);
  return [...ring, ring[0]!];
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/**
 * The hole in the union of `neighbours` that contains `point`, as a Polygon outline with its
 * bounding box. Throws a DeriveError (and returns nothing) if the point is not in an enclosed
 * hole, or the hole is smaller than `minKm2` or larger than `maxKm2`.
 */
export function deriveEnclosedRegion(
  neighbours: readonly Outline[],
  point: { lat: number; lng: number },
  options: DeriveOptions = {},
): DerivedRegion {
  const cell = options.cellDeg ?? 0.002;
  const half = options.windowDeg ?? 0.6;
  const seal = options.sealCells ?? 2;
  const minKm2 = options.minKm2 ?? 100;
  const maxKm2 = options.maxKm2 ?? 2000;
  const simplifyDeg = options.simplifyDeg ?? 0.003;

  const west = point.lng - half;
  const south = point.lat - half;
  const cols = Math.ceil((2 * half) / cell);
  const rows = Math.ceil((2 * half) / cell);
  const covered = new Uint8Array(rows * cols);
  for (const outline of neighbours) {
    for (const rings of polygonsOf(outline)) {
      fillPolygon(rings, covered, rows, cols, west, south, cell);
    }
  }

  const pr = Math.floor((point.lat - south) / cell);
  const pc = Math.floor((point.lng - west) / cell);
  const pointIndex = pr * cols + pc;
  if (covered[pointIndex]) {
    throw new DeriveError(
      `the point (lat ${point.lat}, lon ${point.lng}) lies inside a neighbouring outline, so there is no hole there`,
    );
  }

  // Close thin seams between neighbours, then see what the point is cut off from.
  const closed = grow(covered, rows, cols, seal);
  const free = Uint8Array.from(closed, (v) => (v ? 0 : 1));
  if (!free[pointIndex]) {
    throw new DeriveError(
      `the point (lat ${point.lat}, lon ${point.lng}) is within ${seal} cells of a neighbouring outline, so no free space was found there`,
    );
  }
  const border: number[] = [];
  for (let c = 0; c < cols; c++) border.push(c, (rows - 1) * cols + c);
  for (let r = 0; r < rows; r++) border.push(r * cols, r * cols + cols - 1);
  const outside = flood(free, rows, cols, border);
  if (outside[pointIndex]) {
    throw new DeriveError(
      `the point (lat ${point.lat}, lon ${point.lng}) is not enclosed by the neighbouring outlines: the gap is open to the outside`,
    );
  }
  const core = flood(free, rows, cols, [pointIndex]);
  // Give back the cells the seam closing took from the hole, but only free (uncovered) ones.
  const notCovered = Uint8Array.from(covered, (v) => (v ? 0 : 1));
  const hole = grow(core, rows, cols, seal, notCovered);

  let cells = 0;
  for (const v of hole) cells += v;
  const areaKm2 =
    cells * cell * cell * KM_PER_DEG * KM_PER_DEG * Math.cos((point.lat * Math.PI) / 180);
  if (areaKm2 < minKm2 || areaKm2 > maxKm2) {
    throw new DeriveError(
      `the hole around lat ${point.lat}, lon ${point.lng} is ${Math.round(areaKm2)} km2, outside the accepted ${minKm2} to ${maxKm2} km2`,
    );
  }

  const traced = outerRing(hole, rows, cols, west, south, cell);
  const ring = simplifyRing(traced, simplifyDeg).map(([x, y]): Position => [round5(x), round5(y)]);
  // The box comes from the traced hole, not the simplified ring, so no corner is shaved off.
  const bounds = outlineBounds({ type: 'Polygon', coordinates: [traced] });
  return {
    outline: { type: 'Polygon', coordinates: [ring] },
    bounds: {
      south: round5(bounds.south),
      west: round5(bounds.west),
      north: round5(bounds.north),
      east: round5(bounds.east),
    },
    areaKm2: Math.round(areaKm2),
  };
}
