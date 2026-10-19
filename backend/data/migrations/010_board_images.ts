import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '010_board_images',
  up: /* sql */ `
    -- Only the address of a picture is stored, never the file. image_source says where it came
    -- from; image_checked_at is set once the free lookup has run, whether or not it found one.
    ALTER TABLE companies
      ADD COLUMN image_url text,
      ADD COLUMN image_source text CHECK (image_source IN ('og', 'maps')),
      ADD COLUMN image_checked_at timestamptz,
      ADD CONSTRAINT companies_image_pair CHECK ((image_url IS NULL) = (image_source IS NULL));
    -- Companies still waiting for the lookup.
    CREATE INDEX companies_image_pending_idx ON companies (created_at)
      WHERE image_checked_at IS NULL;

    -- A person's photo address, only when the provider already returned one.
    ALTER TABLE contacts ADD COLUMN photo_url text;

    -- The image lookup reads public web pages: free, but still written to the ledger at $0.
    ALTER TABLE cost_ledger DROP CONSTRAINT cost_ledger_provider_check;
    ALTER TABLE cost_ledger
      ADD CONSTRAINT cost_ledger_provider_check
      CHECK (provider IN ('apify', 'google', 'llm', 'anthropic', 'web'));
  `,
  // Fails if 'web' rows exist: the ledger is append-only, so they cannot be removed.
  down: /* sql */ `
    ALTER TABLE cost_ledger DROP CONSTRAINT cost_ledger_provider_check;
    ALTER TABLE cost_ledger
      ADD CONSTRAINT cost_ledger_provider_check
      CHECK (provider IN ('apify', 'google', 'llm', 'anthropic'));
    ALTER TABLE contacts DROP COLUMN photo_url;
    DROP INDEX companies_image_pending_idx;
    ALTER TABLE companies
      DROP CONSTRAINT companies_image_pair,
      DROP COLUMN image_checked_at,
      DROP COLUMN image_source,
      DROP COLUMN image_url;
  `,
};
