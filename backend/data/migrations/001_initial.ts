import type { Migration } from '../migrate.js';

// Text columns with CHECK constraints instead of Postgres enums, so later migrations can
// add values without ALTER TYPE.
export const migration: Migration = {
  id: '001_initial',
  up: /* sql */ `
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

    -- Reference data shared by all users (seeded from backend/config/regions.ts).
    CREATE TABLE regions (
      id text PRIMARY KEY,
      name text NOT NULL,
      name_fr text NOT NULL,
      country text NOT NULL DEFAULT 'TN'
    );

    -- Each region split into map rectangles, so discovery can search small areas (a Maps search
    -- caps its results) and track which ones are exhausted. A dense cell can be split further;
    -- its children point to it through parent_cell_id. Geometry, not user data: no user_id.
    CREATE TABLE region_cells (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      region_id text NOT NULL REFERENCES regions (id),
      parent_cell_id uuid REFERENCES region_cells (id),
      cell_key text NOT NULL,
      south double precision NOT NULL CHECK (south BETWEEN -90 AND 90),
      west double precision NOT NULL CHECK (west BETWEEN -180 AND 180),
      north double precision NOT NULL CHECK (north BETWEEN -90 AND 90),
      east double precision NOT NULL CHECK (east BETWEEN -180 AND 180),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (region_id, cell_key),
      CHECK (north > south AND east > west)
    );
    CREATE INDEX region_cells_parent_idx ON region_cells (parent_cell_id);

    -- Coverage is kept per cell as counts (not shares), so it sums correctly into a region:
    -- see the region_coverage_rollup view below.
    CREATE TABLE region_coverage (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_cell_id uuid NOT NULL REFERENCES region_cells (id) ON DELETE CASCADE,
      places_found integer NOT NULL DEFAULT 0 CHECK (places_found >= 0),
      qualified_companies integer NOT NULL DEFAULT 0 CHECK (qualified_companies >= 0),
      companies_with_decision_maker integer NOT NULL DEFAULT 0
        CHECK (companies_with_decision_maker >= 0),
      decision_makers_with_channel integer NOT NULL DEFAULT 0
        CHECK (decision_makers_with_channel >= 0),
      leads_found integer NOT NULL DEFAULT 0 CHECK (leads_found >= 0),
      last_run_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, region_cell_id)
    );

    CREATE TABLE runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_id text NOT NULL REFERENCES regions (id),
      sectors text[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'finished', 'failed', 'cancelled', 'stopped_by_cap')),
      current_stage text
        CHECK (current_stage IN ('discover', 'qualify', 'find_people', 'enrich', 'verify', 'score')),
      -- Spend is never stored here: it is summed from cost_ledger.
      budget_cap_usd numeric(12, 4) NOT NULL CHECK (budget_cap_usd > 0),
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz
    );
    CREATE INDEX runs_user_created_idx ON runs (user_id, created_at DESC);

    -- Monthly spending cap per user. month is the first day of the month (UTC). Spend is
    -- summed from cost_ledger.
    CREATE TABLE user_budget (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      month date NOT NULL CHECK (extract(day FROM month) = 1),
      cap_usd numeric(12, 4) NOT NULL CHECK (cap_usd > 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, month)
    );

    CREATE TABLE run_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      stage text NOT NULL
        CHECK (stage IN ('discover', 'qualify', 'find_people', 'enrich', 'verify', 'score')),
      -- Identifies one unit of work inside a stage (e.g. one company), so a step is never started twice.
      step_key text NOT NULL,
      actor_id text,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'started', 'running', 'finished', 'failed')),
      apify_run_id text,
      apify_dataset_id text,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (run_id, stage, step_key),
      -- An Apify-backed step past 'pending' must have stored its IDs.
      CHECK (status = 'pending' OR actor_id IS NULL OR (apify_run_id IS NOT NULL AND apify_dataset_id IS NOT NULL))
    );
    CREATE INDEX run_steps_unfinished_idx ON run_steps (status) WHERE status IN ('started', 'running');

    -- Every dollar spent, append-only. Rows are never updated or deleted (a trigger refuses it);
    -- a correction is a new row with the opposite amount that points at the row it corrects.
    -- Run, month and cost-per-lead totals are sums over this table.
    CREATE TABLE cost_ledger (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
      run_step_id uuid REFERENCES run_steps (id) ON DELETE RESTRICT,
      -- The map cell the spend was for, when it was for one (e.g. a Maps search).
      region_cell_id uuid REFERENCES region_cells (id) ON DELETE RESTRICT,
      provider text NOT NULL CHECK (provider IN ('apify', 'google', 'llm')),
      -- What was bought: an Apify actor ID, a Google SKU, an LLM model.
      item text NOT NULL,
      units numeric(18, 6) NOT NULL,
      unit_price_usd numeric(18, 8) NOT NULL CHECK (unit_price_usd >= 0),
      amount_usd numeric(14, 6) NOT NULL,
      kind text NOT NULL CHECK (kind IN ('estimated', 'actual')),
      corrects_id bigint UNIQUE REFERENCES cost_ledger (id),
      reconciled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (amount_usd = round(units * unit_price_usd, 6)),
      -- Only a correction may be negative.
      CHECK (corrects_id IS NOT NULL OR units >= 0)
    );
    CREATE INDEX cost_ledger_run_idx ON cost_ledger (run_id);
    CREATE INDEX cost_ledger_user_time_idx ON cost_ledger (user_id, created_at);
    CREATE INDEX cost_ledger_cell_idx ON cost_ledger (region_cell_id) WHERE region_cell_id IS NOT NULL;

    CREATE FUNCTION cost_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'cost_ledger is append-only: add a correcting row instead';
    END $$;
    CREATE TRIGGER cost_ledger_no_update_delete BEFORE UPDATE OR DELETE ON cost_ledger
      FOR EACH ROW EXECUTE FUNCTION cost_ledger_append_only();

    -- One row per search sent to a provider, so the scheduler can see which cells and
    -- wordings have stopped finding new places.
    CREATE TABLE search_queries (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      run_step_id uuid REFERENCES run_steps (id) ON DELETE SET NULL,
      region_cell_id uuid NOT NULL REFERENCES region_cells (id) ON DELETE CASCADE,
      provider text NOT NULL,
      query_text text NOT NULL,
      normalized_query text NOT NULL,
      requests_used integer NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
      results_returned integer NOT NULL DEFAULT 0 CHECK (results_returned >= 0),
      new_places_found integer NOT NULL DEFAULT 0
        CHECK (new_places_found BETWEEN 0 AND results_returned),
      cost_usd numeric(12, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX search_queries_cell_idx
      ON search_queries (user_id, region_cell_id, provider, normalized_query);
    CREATE INDEX search_queries_run_idx ON search_queries (run_id);

    CREATE TABLE apify_events (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      run_step_id uuid NOT NULL REFERENCES run_steps (id) ON DELETE CASCADE,
      apify_run_id text NOT NULL,
      state text NOT NULL
        CHECK (state IN ('started', 'running', 'restarting', 'resumed', 'finished', 'failed')),
      message text,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX apify_events_user_time_idx ON apify_events (user_id, occurred_at DESC);

    CREATE TABLE companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name text NOT NULL,
      normalized_name text NOT NULL,
      governorate text NOT NULL REFERENCES regions (id),
      sector text,
      google_place_id text,
      domain text,
      website text,
      phone text,
      email text,
      linkedin_url text,
      -- Where the stored fields came from (e.g. 'google_maps') and when they must be refreshed
      -- or dropped, for providers whose terms limit how long their content may be kept.
      source_provider text,
      refresh_by timestamptz,
      -- The run, and the map cell, that first found this company (cost attribution).
      run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
      region_cell_id uuid REFERENCES region_cells (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX companies_refresh_idx ON companies (user_id, refresh_by) WHERE refresh_by IS NOT NULL;
    CREATE UNIQUE INDEX companies_place_key ON companies (user_id, google_place_id)
      WHERE google_place_id IS NOT NULL;
    CREATE UNIQUE INDEX companies_domain_key ON companies (user_id, domain) WHERE domain IS NOT NULL;
    CREATE INDEX companies_name_idx ON companies (user_id, normalized_name, governorate);

    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      full_name text NOT NULL,
      title text,
      role_class text CHECK (role_class IN
        ('logistics', 'transport', 'supply_chain', 'purchasing', 'operations', 'general_manager')),
      linkedin_public_id text,
      linkedin_url text,
      email text,
      phone text,
      current_role_verified boolean NOT NULL DEFAULT false,
      -- The run that first found this person (cost attribution).
      run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX contacts_linkedin_key ON contacts (user_id, linkedin_public_id)
      WHERE linkedin_public_id IS NOT NULL;
    CREATE INDEX contacts_company_idx ON contacts (company_id);

    -- One row per sourced value. Exactly one of company_id / contact_id is set.
    CREATE TABLE evidence (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      company_id uuid REFERENCES companies (id) ON DELETE CASCADE,
      contact_id uuid REFERENCES contacts (id) ON DELETE CASCADE,
      run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
      field text NOT NULL,
      value text NOT NULL,
      source_url text NOT NULL CHECK (source_url ~ '^https?://'),
      fetched_at timestamptz NOT NULL,
      kind text NOT NULL CHECK (kind IN ('fact', 'estimate')),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((company_id IS NULL) <> (contact_id IS NULL))
    );
    CREATE INDEX evidence_company_idx ON evidence (company_id) WHERE company_id IS NOT NULL;
    CREATE INDEX evidence_contact_idx ON evidence (contact_id) WHERE contact_id IS NOT NULL;

    CREATE TABLE crm_leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- The run that first produced this lead; kept when later runs find it again.
      run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      contact_id uuid REFERENCES contacts (id) ON DELETE CASCADE,
      stage text NOT NULL DEFAULT 'system_suggested' CHECK (stage IN
        ('system_suggested', 'confirmed', 'contacted', 'response', 'dismissed', 'won', 'lost', 'opted_out')),
      score_company_fit smallint NOT NULL CHECK (score_company_fit BETWEEN 0 AND 50),
      score_contact_fit smallint NOT NULL CHECK (score_contact_fit BETWEEN 0 AND 30),
      score_reachability smallint NOT NULL CHECK (score_reachability BETWEEN 0 AND 20),
      score_total smallint GENERATED ALWAYS AS
        (score_company_fit + score_contact_fit + score_reachability) STORED,
      stage_changed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- A company/contact pair is one lead per user, so a dismissed lead cannot come back as new.
      UNIQUE NULLS NOT DISTINCT (user_id, company_id, contact_id)
    );
    CREATE INDEX crm_leads_user_stage_idx ON crm_leads (user_id, stage);
    CREATE INDEX crm_leads_run_idx ON crm_leads (run_id);

    -- Global on purpose: a person who objects is suppressed for every user of the system.
    CREATE TABLE suppression_list (
      id bigserial PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('email', 'phone', 'linkedin')),
      value text NOT NULL,
      reason text NOT NULL,
      recorded_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (kind, value)
    );

    -- Region totals summed from cells, with the shares and cost per lead derived from the sums.
    CREATE VIEW region_coverage_rollup AS
    SELECT c.user_id,
           rc.region_id,
           count(*)::integer AS cells_covered,
           sum(c.places_found)::integer AS places_found,
           sum(c.qualified_companies)::integer AS qualified_companies,
           sum(c.companies_with_decision_maker)::integer AS companies_with_decision_maker,
           sum(c.decision_makers_with_channel)::integer AS decision_makers_with_channel,
           sum(c.leads_found)::integer AS leads_found,
           max(c.last_run_at) AS last_run_at
      FROM region_coverage c
      JOIN region_cells rc ON rc.id = c.region_cell_id
     GROUP BY c.user_id, rc.region_id;
  `,
  down: /* sql */ `
    DROP VIEW region_coverage_rollup;
    DROP TABLE suppression_list;
    DROP TABLE crm_leads;
    DROP TABLE evidence;
    DROP TABLE contacts;
    DROP TABLE companies;
    DROP TABLE apify_events;
    DROP TABLE cost_ledger;
    DROP FUNCTION cost_ledger_append_only();
    DROP TABLE search_queries;
    DROP TABLE run_steps;
    DROP TABLE user_budget;
    DROP TABLE runs;
    DROP TABLE region_coverage;
    DROP TABLE region_cells;
    DROP TABLE regions;
    DROP TABLE users;
  `,
};
