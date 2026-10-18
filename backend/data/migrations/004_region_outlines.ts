import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '004_region_outlines',
  up: /* sql */ `
    -- Simplified governorate outline (GeoJSON Polygon or MultiPolygon). Search cells that miss
    -- it are dropped, and so are discovered places that fall outside it.
    -- bounds_source: 'osm' bounds come from the committed OpenStreetMap files and are replaced
    -- when those change; 'manual' bounds were set by hand and are never overwritten by a seed.
    ALTER TABLE regions
      ADD COLUMN outline jsonb,
      ADD COLUMN bounds_source text CHECK (bounds_source IN ('osm', 'manual'));
    UPDATE regions SET bounds_source = 'manual' WHERE south IS NOT NULL;

    -- Places the discovery stage found outside the region's outline and discarded.
    ALTER TABLE runs ADD COLUMN places_dropped_outside integer NOT NULL DEFAULT 0
      CHECK (places_dropped_outside >= 0);
  `,
  down: /* sql */ `
    ALTER TABLE runs DROP COLUMN places_dropped_outside;
    ALTER TABLE regions DROP COLUMN bounds_source, DROP COLUMN outline;
  `,
};
