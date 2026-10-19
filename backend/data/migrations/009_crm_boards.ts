import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '009_crm_boards',
  up: /* sql */ `
    -- The two CRM boards and their columns, left to right. Keys are what the API and the
    -- shared BOARD_STAGES constant use; a test keeps the two in step.
    CREATE TABLE pipelines (
      key text PRIMARY KEY,
      name text NOT NULL,
      position smallint NOT NULL
    );
    CREATE TABLE pipeline_stages (
      pipeline text NOT NULL REFERENCES pipelines (key),
      key text NOT NULL,
      name text NOT NULL,
      position smallint NOT NULL,
      collapsed_by_default boolean NOT NULL DEFAULT false,
      PRIMARY KEY (pipeline, key)
    );
    INSERT INTO pipelines (key, name, position) VALUES ('companies', 'Companies', 1), ('people', 'People', 2);
    INSERT INTO pipeline_stages (pipeline, key, name, position, collapsed_by_default) VALUES
      ('companies', 'found', 'Found', 1, false),
      ('companies', 'investigating', 'Investigating', 2, false),
      ('companies', 'decision_maker_identified', 'Decision-maker identified', 3, false),
      ('companies', 'noise', 'Noise', 4, true),
      ('people', 'new', 'New', 1, false),
      ('people', 'contacted', 'Contacted', 2, false),
      ('people', 'replied', 'Replied', 3, false),
      ('people', 'won', 'Won', 4, false),
      ('people', 'lost', 'Lost', 5, false),
      ('people', 'opted_out', 'Opted out', 6, false),
      ('people', 'noise', 'Noise', 7, true);

    -- One card per company on the Companies board and one per person on the People board.
    -- The person is linked to its company twice over: contact_id's company and company_id here.
    CREATE TABLE crm_cards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      pipeline text NOT NULL,
      stage text NOT NULL,
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      contact_id uuid REFERENCES contacts (id) ON DELETE CASCADE,
      stage_entered_at timestamptz NOT NULL DEFAULT now(),
      -- Set exactly while the card is in Noise; the daily purge deletes cards older than the
      -- retention. Opted out cards can never have it, so they can never be purged.
      noise_at timestamptz,
      noise_from_stage text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (pipeline, stage) REFERENCES pipeline_stages (pipeline, key),
      CHECK ((pipeline = 'companies') = (contact_id IS NULL)),
      CHECK ((stage = 'noise') = (noise_at IS NOT NULL)),
      UNIQUE NULLS NOT DISTINCT (user_id, pipeline, company_id, contact_id)
    );
    CREATE INDEX crm_cards_board_idx ON crm_cards (user_id, pipeline, stage);
    CREATE INDEX crm_cards_noise_idx ON crm_cards (noise_at) WHERE noise_at IS NOT NULL;
    CREATE INDEX crm_cards_company_idx ON crm_cards (company_id);

    -- What is left of a purged Noise card, so later runs skip it instead of finding it again.
    -- A company is matched by place ID, or by name plus phone (name plus governorate when it had
    -- neither); a person by LinkedIn ID, email or phone. The sector and role class stay so the
    -- dismissal feedback on scoring does not fade when the card is deleted.
    CREATE TABLE noise_markers (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('company', 'person')),
      google_place_id text,
      normalized_name text,
      governorate text,
      phone_key text,
      email text,
      linkedin_public_id text,
      sector text,
      role_class text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX noise_markers_place_idx ON noise_markers (user_id, google_place_id)
      WHERE google_place_id IS NOT NULL;
    CREATE INDEX noise_markers_name_idx ON noise_markers (user_id, normalized_name)
      WHERE kind = 'company';
    CREATE INDEX noise_markers_linkedin_idx ON noise_markers (user_id, linkedin_public_id)
      WHERE linkedin_public_id IS NOT NULL;

    -- Existing leads become Companies cards in Found: one per company, however many leads it had.
    INSERT INTO crm_cards (user_id, pipeline, stage, company_id, stage_entered_at)
    SELECT l.user_id, 'companies', 'found', l.company_id, min(l.created_at)
      FROM crm_leads l
     GROUP BY l.user_id, l.company_id;
  `,
  down: /* sql */ `
    DROP TABLE noise_markers;
    DROP TABLE crm_cards;
    DROP TABLE pipeline_stages;
    DROP TABLE pipelines;
  `,
};
