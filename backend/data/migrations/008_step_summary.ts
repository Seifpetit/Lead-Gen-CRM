import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '008_step_summary',
  up: /* sql */ `
    -- What a step's result came to (results, kept, dropped and why, people found), written
    -- when the result is applied. Read by the Apify log; null for steps from before this.
    ALTER TABLE run_steps ADD COLUMN summary jsonb;
  `,
  down: /* sql */ `
    ALTER TABLE run_steps DROP COLUMN summary;
  `,
};
