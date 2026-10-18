import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '003_orchestrator',
  up: /* sql */ `
    -- Map bounds per region, so the runner can build its grid of cells. Nullable until real
    -- governorate bounds are seeded.
    ALTER TABLE regions
      ADD COLUMN south double precision,
      ADD COLUMN west double precision,
      ADD COLUMN north double precision,
      ADD COLUMN east double precision,
      ADD CONSTRAINT regions_bounds_check CHECK (
        (south IS NULL AND west IS NULL AND north IS NULL AND east IS NULL)
        OR (north > south AND east > west));

    -- normal: search new places; maintenance: slow re-runs of a saturated region.
    ALTER TABLE runs
      ADD COLUMN mode text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'maintenance')),
      ADD COLUMN heartbeat_at timestamptz;
    CREATE INDEX runs_active_idx ON runs (user_id) WHERE status IN ('pending', 'running');

    -- What a step was asked to do and what came back, so a restart never has to call a
    -- provider again for a result it already paid for.
    ALTER TABLE run_steps
      ADD COLUMN provider text,
      ADD COLUMN region_cell_id uuid REFERENCES region_cells (id) ON DELETE SET NULL,
      ADD COLUMN input jsonb,
      ADD COLUMN output jsonb,
      ADD COLUMN apify_status text,
      ADD COLUMN apify_restarts integer NOT NULL DEFAULT 0,
      ADD COLUMN last_polled_at timestamptz,
      -- The max cost passed to Apify. Until the step settles, max cost minus its estimate is
      -- reserved, so steps running side by side can't together overshoot a cap.
      ADD COLUMN max_charge_usd numeric(12, 4) CHECK (max_charge_usd >= 0),
      -- Set in the same transaction that turns the step's result into companies, contacts or
      -- leads, so a result is never applied twice.
      ADD COLUMN processed_at timestamptz;
    -- A step interrupted before its Apify run was recorded is closed as failed without run
    -- IDs (it is never started again), so 'failed' no longer requires them.
    ALTER TABLE run_steps DROP CONSTRAINT run_steps_check,
      ADD CONSTRAINT run_steps_check CHECK (status IN ('pending', 'failed') OR actor_id IS NULL
        OR (apify_run_id IS NOT NULL AND apify_dataset_id IS NOT NULL));
    CREATE INDEX run_steps_apify_run_idx ON run_steps (apify_run_id) WHERE apify_run_id IS NOT NULL;

    -- A run claims the cells it searches. A claim expires unless the run renews it, so a dead
    -- run releases its cells. Claims are per user: cells are shared geometry, but two users
    -- searching the same area are separate customers.
    CREATE TABLE cell_claims (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_cell_id uuid NOT NULL REFERENCES region_cells (id) ON DELETE CASCADE,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (user_id, region_cell_id)
    );
    CREATE INDEX cell_claims_run_idx ON cell_claims (run_id);

    -- Each company's progress through one run. Only the orchestrator writes it.
    CREATE TABLE run_companies (
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_cell_id uuid REFERENCES region_cells (id) ON DELETE SET NULL,
      -- True when this run created the company. Only new companies (and stale contacts in a
      -- maintenance run) go through the paid stages.
      is_new boolean NOT NULL,
      state text NOT NULL CHECK (state IN ('discovered', 'qualified', 'rejected', 'review',
        'people_found', 'enriched', 'verified', 'scored', 'skipped')),
      -- Stage outputs (place, qualification, people, emails), kept for the next stage.
      payload jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, company_id)
    );
    CREATE INDEX run_companies_state_idx ON run_companies (run_id, state);

    -- A wording that stopped finding new places in a cell.
    CREATE TABLE exhausted_queries (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_cell_id uuid NOT NULL REFERENCES region_cells (id) ON DELETE CASCADE,
      normalized_query text NOT NULL,
      exhausted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, region_cell_id, normalized_query)
    );

    -- A cell is exhausted when every wording is.
    ALTER TABLE region_coverage ADD COLUMN exhausted_at timestamptz;

    -- A region is saturated when every cell is exhausted; it then switches to maintenance.
    CREATE TABLE region_status (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_id text NOT NULL REFERENCES regions (id),
      mode text NOT NULL CHECK (mode IN ('active', 'saturated')),
      saturated_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, region_id)
    );
  `,
  down: /* sql */ `
    DROP TABLE region_status;
    ALTER TABLE region_coverage DROP COLUMN exhausted_at;
    DROP TABLE exhausted_queries;
    DROP TABLE run_companies;
    DROP TABLE cell_claims;
    DROP INDEX run_steps_apify_run_idx;
    ALTER TABLE run_steps DROP CONSTRAINT run_steps_check,
      ADD CONSTRAINT run_steps_check CHECK (status = 'pending' OR actor_id IS NULL
        OR (apify_run_id IS NOT NULL AND apify_dataset_id IS NOT NULL));
    ALTER TABLE run_steps
      DROP COLUMN provider, DROP COLUMN region_cell_id, DROP COLUMN input, DROP COLUMN output,
      DROP COLUMN apify_status, DROP COLUMN apify_restarts, DROP COLUMN last_polled_at,
      DROP COLUMN max_charge_usd,
      DROP COLUMN processed_at;
    DROP INDEX runs_active_idx;
    ALTER TABLE runs DROP COLUMN mode, DROP COLUMN heartbeat_at;
    ALTER TABLE regions DROP CONSTRAINT regions_bounds_check,
      DROP COLUMN south, DROP COLUMN west, DROP COLUMN north, DROP COLUMN east;
  `,
};
