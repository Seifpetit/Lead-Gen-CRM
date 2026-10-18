/** What the coverage widgets hand to Start a run when a cell is clicked. */
export interface StartPrefill {
  regionId: string;
  /** A single sector, from the coverage grid. */
  sectorIds?: string[];
  /** A single map cell, from the coverage map. */
  cellKeys?: string[];
}
