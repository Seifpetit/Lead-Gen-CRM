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

    CREATE TABLE region_coverage (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_id text NOT NULL REFERENCES regions (id),
      places_found integer NOT NULL DEFAULT 0 CHECK (places_found >= 0),
      leads_found integer NOT NULL DEFAULT 0 CHECK (leads_found >= 0),
      qualified_share numeric(5, 4) CHECK (qualified_share BETWEEN 0 AND 1),
      decision_maker_share numeric(5, 4) CHECK (decision_maker_share BETWEEN 0 AND 1),
      channel_share numeric(5, 4) CHECK (channel_share BETWEEN 0 AND 1),
      spent_usd numeric(12, 4) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
      cost_per_lead_usd numeric(12, 4) CHECK (cost_per_lead_usd >= 0),
      last_run_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, region_id)
    );

    CREATE TABLE runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      region_id text NOT NULL REFERENCES regions (id),
      sectors text[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'finished', 'failed', 'cancelled')),
      current_stage text
        CHECK (current_stage IN ('discover', 'qualify', 'find_people', 'enrich', 'verify', 'score')),
      spend_cap_usd numeric(12, 4) NOT NULL CHECK (spend_cap_usd > 0),
      spent_usd numeric(12, 4) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz
    );
    CREATE INDEX runs_user_created_idx ON runs (user_id, created_at DESC);

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
      cost_usd numeric(12, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
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
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
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
  `,
  down: /* sql */ `
    DROP TABLE suppression_list;
    DROP TABLE crm_leads;
    DROP TABLE evidence;
    DROP TABLE contacts;
    DROP TABLE companies;
    DROP TABLE apify_events;
    DROP TABLE run_steps;
    DROP TABLE runs;
    DROP TABLE region_coverage;
    DROP TABLE regions;
    DROP TABLE users;
  `,
};
