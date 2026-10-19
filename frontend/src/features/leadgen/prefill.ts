/** What the coverage page hands to Start a run: a region, or a sector and some regions. */
export interface StartPrefill {
  /** One region, from a region's title: the form starts on it with the sector chips to choose. */
  regionId?: string;
  /**
   * From a sector: the regions chosen to begin with (possibly none). Its presence turns the
   * region field into region chips, so one sector can be run across several regions.
   */
  regionIds?: string[];
  /** The sector or sectors ticked to begin with. */
  sectorIds?: string[];
  /** A single map cell of the region. */
  cellKeys?: string[];
}
