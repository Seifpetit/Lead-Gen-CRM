import { describe, expect, it } from 'vitest';
import {
  outlineBounds,
  placeInOutline,
  pointInOutline,
  type Bounds,
  type Outline,
} from '../lib/geo.js';
import outlinesFile from './regionOutlines.json' with { type: 'json' };
import { REGION_BOUNDS } from './regionBounds.js';
import { TUNISIAN_GOVERNORATES } from './regions.js';

// The committed outlines are the geoBoundaries ADM1 file for Tunisia: one dataset, so the 24
// governorates share their borders. These tests keep it that way when the file is rebuilt.

const outlines = outlinesFile.outlines as unknown as Record<string, Outline>;
const ids = TUNISIAN_GOVERNORATES.map((g) => g.id);

/** Area in km2, with longitude scaled at the shape's mean latitude; good to a few percent. */
function areaKm2(outline: Outline): number {
  const polys = outline.type === 'Polygon' ? [outline.coordinates] : outline.coordinates;
  let total = 0;
  for (const rings of polys) {
    const lats = rings[0]!.map((p) => p[1]);
    const scale = Math.cos((lats.reduce((x, y) => x + y, 0) / lats.length) * (Math.PI / 180));
    rings.forEach((ring, i) => {
      let a = 0;
      for (let k = 1; k < ring.length; k++) {
        a += ring[k - 1]![0] * ring[k]![1] - ring[k]![0] * ring[k - 1]![1];
      }
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2) * scale * 111.2 * 111.2;
    });
  }
  return total;
}

describe('committed region outlines', () => {
  it('has all 24 governorates, with bounds that are the box of the outline', () => {
    expect(Object.keys(outlines).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const b = outlineBounds(outlines[id]!);
      const stored: Bounds = REGION_BOUNDS[id];
      expect(stored.south).toBeCloseTo(b.south, 5);
      expect(stored.west).toBeCloseTo(b.west, 5);
      expect(stored.north).toBeCloseTo(b.north, 5);
      expect(stored.east).toBeCloseTo(b.east, 5);
    }
  });

  it('keeps the full detail of the source, not a simplified shape', () => {
    const vertices = (o: Outline) =>
      (o.type === 'Polygon' ? [o.coordinates] : o.coordinates).reduce(
        (n, rings) => n + rings.reduce((m, r) => m + r.length, 0),
        0,
      );
    for (const id of ids) expect(vertices(outlines[id]!), id).toBeGreaterThan(700);
  });

  it('gives each governorate its real size (El Kef was 427 km2, a fraction of itself)', () => {
    expect(areaKm2(outlines.kef!)).toBeGreaterThan(4_500);
    expect(areaKm2(outlines.kef!)).toBeLessThan(5_500);
    expect(areaKm2(outlines.manouba!)).toBeGreaterThan(1_000);
    expect(areaKm2(outlines.manouba!)).toBeLessThan(1_300);
    const country = ids.reduce((n, id) => n + areaKm2(outlines[id]!), 0);
    expect(country).toBeGreaterThan(150_000); // Tunisia is about 164,000 km2
    expect(country).toBeLessThan(170_000);
  });

  it('has the Algeria edge: known border towns of the west are inside the right governorate', () => {
    const towns: [string, number, number, string][] = [
      ['Ghardimaou', 36.4492, 8.4408, 'jendouba'],
      ['Sakiet Sidi Youssef', 36.2265, 8.3563, 'kef'],
      ['Nebeur', 36.3, 8.78, 'kef'],
      ['Tajerouine', 35.9, 8.55, 'kef'],
      ['Haidra', 35.5717, 8.4733, 'kasserine'],
      ['Redeyef', 34.3833, 8.15, 'gafsa'],
      ['Nefta', 33.8731, 7.8778, 'tozeur'],
      ['Hazoua', 33.6, 7.9, 'tozeur'],
      ['Douz', 33.4592, 9.0211, 'kebili'],
      ['Remada', 32.3078, 10.3922, 'tataouine'],
    ];
    for (const [name, lat, lng, id] of towns) {
      const inside = ids.filter((r) => pointInOutline(lat, lng, outlines[r]!));
      expect(inside, name).toEqual([id]);
    }
    // The western edge of each western governorate reaches the border, not a city-sized stub.
    const west = (id: string) => outlineBounds(outlines[id]!).west;
    expect(west('kef')).toBeLessThan(8.3);
    expect(west('jendouba')).toBeLessThan(8.2);
    expect(west('kasserine')).toBeLessThan(8.3);
    expect(west('gafsa')).toBeLessThan(8.1);
    expect(west('tozeur')).toBeLessThan(7.6);
    expect(west('kebili')).toBeLessThan(7.8);
    expect(west('tataouine')).toBeLessThan(8.4);
  });

  describe('the union of all outlines', () => {
    // A grid over the whole country: how many regions hold each point.
    const STEP = 0.01;
    const south = 30;
    const north = 37.6;
    const west = 7.4;
    const east = 11.7;
    const rows = Math.round((north - south) / STEP);
    const cols = Math.round((east - west) / STEP);
    const holders: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    const boxes = ids.map((id) => ({ id, b: REGION_BOUNDS[id], o: outlines[id]! }));
    for (const { b, o } of boxes) {
      const r0 = Math.max(0, Math.floor((b.south - south) / STEP));
      const r1 = Math.min(rows - 1, Math.ceil((b.north - south) / STEP));
      const c0 = Math.max(0, Math.floor((b.west - west) / STEP));
      const c1 = Math.min(cols - 1, Math.ceil((b.east - west) / STEP));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (pointInOutline(south + (r + 0.5) * STEP, west + (c + 0.5) * STEP, o)) {
            holders[r]![c]!++;
          }
        }
      }
    }

    it('has no overlaps: no point is inside two governorates', () => {
      let both = 0;
      for (const row of holders) for (const n of row) if (n > 1) both++;
      expect(both).toBe(0);
    });

    it('has no gaps: every empty point is outside the country (sea, Algeria, Libya) or the Lac de Tunis', () => {
      // Flood the empty points from the grid's edge; an empty point the flood cannot reach is
      // enclosed by governorates, which would be a hole between them.
      const outside = holders.map((row) => row.map(() => false));
      const queue: [number, number][] = [];
      const visit = (r: number, c: number) => {
        if (r < 0 || c < 0 || r >= rows || c >= cols) return;
        if (outside[r]![c] || holders[r]![c]! > 0) return;
        outside[r]![c] = true;
        queue.push([r, c]);
      };
      for (let r = 0; r < rows; r++) {
        visit(r, 0);
        visit(r, cols - 1);
      }
      for (let c = 0; c < cols; c++) {
        visit(0, c);
        visit(rows - 1, c);
      }
      for (let i = 0; i < queue.length; i++) {
        const [r, c] = queue[i]!;
        visit(r + 1, c);
        visit(r - 1, c);
        visit(r, c + 1);
        visit(r, c - 1);
      }
      const enclosed: [number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (holders[r]![c] === 0 && !outside[r]![c]) {
            enclosed.push([south + (r + 0.5) * STEP, west + (c + 0.5) * STEP]);
          }
        }
      }
      // Water the boundaries leave out: Lac de Tunis, Lac de Bizerte, the Kerkennah channel and
      // the sebkha near Enfidha. Anything else enclosed would be a gap between governorates.
      const water: Bounds[] = [
        { south: 36.77, west: 10.2, north: 36.82, east: 10.3 },
        { south: 37.1, west: 9.75, north: 37.3, east: 9.95 },
        { south: 34.7, west: 10.7, north: 34.8, east: 10.8 },
        { south: 35.95, west: 10.4, north: 36.05, east: 10.5 },
      ];
      const stray = enclosed.filter(
        ([lat, lng]) =>
          !water.some((w) => lat >= w.south && lat <= w.north && lng >= w.west && lng <= w.east),
      );
      expect(stray).toEqual([]);
    });

    it('covers the national territory: the points tested above lie in some governorate', () => {
      const covered = holders.reduce((n, row) => n + row.filter((h) => h > 0).length, 0);
      // 0.01 degree cells are about 1 km2 each.
      expect(covered).toBeGreaterThan(140_000);
    });
  });

  it('tolerates a place a few hundred metres off the coast of its own governorate', () => {
    // Full precision outlines need less forgiveness than the old simplified ones.
    expect(placeInOutline(36.8065, 10.1815, outlines.tunis!, 0.005)).toBe(true);
  });
});
