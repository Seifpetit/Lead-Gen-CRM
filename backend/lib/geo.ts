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
