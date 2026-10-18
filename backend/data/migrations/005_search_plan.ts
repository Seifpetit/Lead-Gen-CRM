import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '005_search_plan',
  up: /* sql */ `
    -- What the user chose in Start a run beyond the region: extra wordings, "only these" for
    -- the sectors (sectors = '{}' alone still means all of them), and cells to restrict to.
    ALTER TABLE runs
      ADD COLUMN custom_wordings text[] NOT NULL DEFAULT '{}',
      ADD COLUMN custom_only boolean NOT NULL DEFAULT false,
      ADD COLUMN cell_keys text[] NOT NULL DEFAULT '{}';

    -- The sector of the wording that was searched (null for a custom wording), so coverage can
    -- be reported per region and sector.
    ALTER TABLE search_queries ADD COLUMN sector_id text;
    UPDATE search_queries q SET sector_id = s.input ->> 'sectorId'
      FROM run_steps s WHERE s.id = q.run_step_id;
    CREATE INDEX search_queries_sector_idx ON search_queries (user_id, sector_id);
  `,
  down: /* sql */ `
    DROP INDEX search_queries_sector_idx;
    ALTER TABLE search_queries DROP COLUMN sector_id;
    ALTER TABLE runs DROP COLUMN cell_keys, DROP COLUMN custom_only, DROP COLUMN custom_wordings;
  `,
};
