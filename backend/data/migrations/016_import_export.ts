import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '016_import_export',
  up: /* sql */ `
    -- What a company does in international trade. Empty (NULL) means "not checked yet": every
    -- company found before this migration keeps it empty and nothing is deleted or hidden.
    ALTER TABLE companies ADD COLUMN trade_role text
      CHECK (trade_role IN ('exporter', 'importer', 'both', 'trader', 'not_import_export',
                            'unclear', 'competitor_or_partner'));
    CREATE INDEX companies_trade_role_idx ON companies (user_id, trade_role);

    -- Which scoring rules produced a lead's score, so an old score is never read as a new one.
    ALTER TABLE crm_leads ADD COLUMN scoring_version integer NOT NULL DEFAULT 1;

    -- Coverage was learned with the old domestic-transport search terms. Searches are tagged
    -- with the query set that sent them (1 = old terms, 2 = import/export terms); the rows of
    -- the old set stay as history. The tables below hold only the current set, so the old
    -- numbers are copied to coverage_history and the live tables start clean.
    ALTER TABLE search_queries ADD COLUMN query_set integer NOT NULL DEFAULT 1;
    CREATE INDEX search_queries_query_set_idx ON search_queries (user_id, query_set);

    CREATE TABLE coverage_history (
      id bigserial PRIMARY KEY,
      query_set integer NOT NULL,
      kind text NOT NULL CHECK (kind IN ('region_coverage', 'exhausted_queries', 'region_status')),
      data jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO coverage_history (query_set, kind, data)
      SELECT 1, 'region_coverage', to_jsonb(c) FROM region_coverage c;
    INSERT INTO coverage_history (query_set, kind, data)
      SELECT 1, 'exhausted_queries', to_jsonb(e) FROM exhausted_queries e;
    INSERT INTO coverage_history (query_set, kind, data)
      SELECT 1, 'region_status', to_jsonb(s) FROM region_status s;
    DELETE FROM region_coverage;
    DELETE FROM exhausted_queries;
    DELETE FROM region_status;

    -- An old-lead check keeps its spend in the ledger like a run does, on a run of this kind.
    -- It is created already finished, so it is never resumed or counted as a running run.
    ALTER TABLE runs ADD COLUMN kind text NOT NULL DEFAULT 'search'
      CHECK (kind IN ('search', 'trade_check'));
  `,
  down: /* sql */ `
    ALTER TABLE runs DROP COLUMN kind;
    DROP TABLE coverage_history;
    DROP INDEX search_queries_query_set_idx;
    ALTER TABLE search_queries DROP COLUMN query_set;
    ALTER TABLE crm_leads DROP COLUMN scoring_version;
    DROP INDEX companies_trade_role_idx;
    ALTER TABLE companies DROP COLUMN trade_role;
  `,
};
