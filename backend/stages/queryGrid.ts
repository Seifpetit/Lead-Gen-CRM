import { FREIGHT_SECTORS } from '../config/sectors.js';
import { splitBounds, type Bounds } from '../lib/geo.js';
import { normalizeQuery } from '../lib/normalize.js';
import type { DiscoveryQuery } from '../providers/types.js';

export interface GridCell {
  key: string;
  bounds: Bounds;
  /** Share of the cell inside the region's outline; the most inside are searched first. */
  overlap?: number;
}

export interface QueryGridInput {
  regionId: string;
  bounds: Bounds;
  /** Sectors to search; all freight sectors when omitted, none when empty. */
  sectorIds?: readonly string[];
  /** Extra wordings typed in by the user; searched as given, with no sector. */
  customWordings?: readonly string[];
  /** Roughly how many queries to produce before skips. Default 150. */
  targetQueries?: number;
  /** Leaf cells already stored for the region (after any splits). Generated when omitted. */
  cells?: readonly GridCell[];
  exhaustedCellKeys?: Iterable<string>;
  /** A wording with no cellKey is exhausted everywhere in the region. */
  exhaustedWordings?: Iterable<{ cellKey: string | null; normalizedQuery: string }>;
  maxPlacesPerQuery?: number;
}

export interface QueryGrid {
  cells: GridCell[];
  queries: DiscoveryQuery[];
  skipped: { exhaustedCells: number; exhaustedQueries: number };
}

const MAX_CELLS = 64;

/** rows x cols near `n` cells, shaped to the rectangle's real-world aspect ratio. */
export function gridShape(bounds: Bounds, n: number): { rows: number; cols: number } {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const heightKm = (bounds.north - bounds.south) * 111;
  const widthKm = Math.max((bounds.east - bounds.west) * 111 * Math.cos(midLat), 1e-9);
  const rows = Math.max(1, Math.round(Math.sqrt((n * heightKm) / widthKm)));
  const cols = Math.max(1, Math.round(n / rows));
  return { rows, cols };
}

/** Longest and most extra wordings a run accepts. */
export const MAX_CUSTOM_WORDINGS = 20;
export const MAX_WORDING_CHARS = 80;

/** Trims, collapses whitespace, strips control characters, drops empties and duplicates. */
export function cleanWordings(wordings: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of wordings) {
    const text = raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = normalizeQuery(text);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * Turns one region into many small searches: each French sector wording in each map cell.
 * Deterministic for the same input. Queries are ordered wording by wording across all
 * cells, and the cells with most of their area inside the region come first, so a run cut
 * short by its budget covers the real region before its edges.
 */
export function buildQueryGrid(input: QueryGridInput): QueryGrid {
  const target = input.targetQueries ?? 150;
  const sectorIds = input.sectorIds ? new Set(input.sectorIds) : null;
  const sectors = FREIGHT_SECTORS.filter((s) => !sectorIds || sectorIds.has(s.id));
  if (sectorIds && sectors.length !== sectorIds.size) {
    const known = new Set<string>(FREIGHT_SECTORS.map((s) => s.id));
    throw new Error(`Unknown sector: ${[...sectorIds].filter((id) => !known.has(id)).join(', ')}`);
  }

  // One entry per distinct wording; the first sector that lists it owns it.
  const wordings: { sectorId: string | null; textQuery: string; normalizedQuery: string }[] = [];
  const seenWordings = new Set<string>();
  for (const sector of sectors) {
    for (const term of sector.searchTermsFr) {
      const normalizedQuery = normalizeQuery(term);
      if (seenWordings.has(normalizedQuery)) continue;
      seenWordings.add(normalizedQuery);
      wordings.push({ sectorId: sector.id, textQuery: term, normalizedQuery });
    }
  }

  for (const term of input.customWordings ?? []) {
    const normalizedQuery = normalizeQuery(term);
    if (normalizedQuery === '' || seenWordings.has(normalizedQuery)) continue;
    seenWordings.add(normalizedQuery);
    wordings.push({ sectorId: null, textQuery: term, normalizedQuery });
  }

  let cells: GridCell[];
  if (input.cells && input.cells.length > 0) {
    cells = [...input.cells];
  } else {
    const n = Math.min(MAX_CELLS, Math.max(1, Math.round(target / Math.max(wordings.length, 1))));
    const { rows, cols } = gridShape(input.bounds, n);
    cells = splitBounds(input.bounds, rows, cols);
  }
  cells.sort((a, b) => (b.overlap ?? 1) - (a.overlap ?? 1) || a.key.localeCompare(b.key));

  const exhaustedCells = new Set(input.exhaustedCellKeys ?? []);
  const everywhere = new Set<string>();
  const perCell = new Set<string>();
  for (const w of input.exhaustedWordings ?? []) {
    const q = normalizeQuery(w.normalizedQuery);
    if (w.cellKey === null) everywhere.add(q);
    else perCell.add(`${w.cellKey}\u0000${q}`);
  }

  const liveCells = cells.filter((c) => !exhaustedCells.has(c.key));
  const queries: DiscoveryQuery[] = [];
  let exhaustedQueries = 0;
  for (const w of wordings) {
    for (const cell of liveCells) {
      if (
        everywhere.has(w.normalizedQuery) ||
        perCell.has(`${cell.key}\u0000${w.normalizedQuery}`)
      ) {
        exhaustedQueries++;
        continue;
      }
      queries.push({
        regionId: input.regionId,
        cellKey: cell.key,
        bounds: cell.bounds,
        sectorId: w.sectorId,
        textQuery: w.textQuery,
        normalizedQuery: w.normalizedQuery,
        languageCode: 'fr',
        maxPlaces: input.maxPlacesPerQuery ?? 60,
      });
    }
  }
  return {
    cells,
    queries,
    skipped: { exhaustedCells: cells.length - liveCells.length, exhaustedQueries },
  };
}
