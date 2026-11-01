import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '017_countries',
  up: /* sql */ `
    -- Every row that belongs to a place now says which country it is in. Everything stored so far
    -- was found in Tunisia, so the default and the backfill are both 'TN'. regions already had
    -- the column (001).
    ALTER TABLE runs ADD COLUMN country text NOT NULL DEFAULT 'TN';
    ALTER TABLE companies ADD COLUMN country text NOT NULL DEFAULT 'TN';
    ALTER TABLE region_cells ADD COLUMN country text NOT NULL DEFAULT 'TN';
    ALTER TABLE region_coverage ADD COLUMN country text NOT NULL DEFAULT 'TN';
    ALTER TABLE exhausted_queries ADD COLUMN country text NOT NULL DEFAULT 'TN';
    ALTER TABLE search_queries ADD COLUMN country text NOT NULL DEFAULT 'TN';

    CREATE INDEX runs_country_idx ON runs (user_id, country);
    CREATE INDEX companies_country_idx ON companies (user_id, country);
    CREATE INDEX search_queries_country_idx ON search_queries (user_id, country);

    -- A row's country is the country of its region, so it cannot disagree with it. These fill it
    -- in on insert; the code never has to remember to.
    CREATE FUNCTION country_from_region() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      SELECT country INTO NEW.country FROM regions WHERE id = NEW.region_id;
      RETURN NEW;
    END $$;
    CREATE FUNCTION country_from_cell() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.region_cell_id IS NOT NULL THEN
        SELECT country INTO NEW.country FROM region_cells WHERE id = NEW.region_cell_id;
      END IF;
      RETURN NEW;
    END $$;
    -- A company takes the country of the cell it was found in, else of the run that found it.
    CREATE FUNCTION country_from_cell_or_run() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.region_cell_id IS NOT NULL THEN
        SELECT country INTO NEW.country FROM region_cells WHERE id = NEW.region_cell_id;
      ELSIF NEW.run_id IS NOT NULL THEN
        SELECT country INTO NEW.country FROM runs WHERE id = NEW.run_id;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER companies_country BEFORE INSERT ON companies
      FOR EACH ROW EXECUTE FUNCTION country_from_cell_or_run();
    CREATE TRIGGER runs_country BEFORE INSERT ON runs
      FOR EACH ROW EXECUTE FUNCTION country_from_region();
    CREATE TRIGGER region_cells_country BEFORE INSERT ON region_cells
      FOR EACH ROW EXECUTE FUNCTION country_from_region();
    CREATE TRIGGER region_coverage_country BEFORE INSERT ON region_coverage
      FOR EACH ROW EXECUTE FUNCTION country_from_cell();
    CREATE TRIGGER exhausted_queries_country BEFORE INSERT ON exhausted_queries
      FOR EACH ROW EXECUTE FUNCTION country_from_cell();
    CREATE TRIGGER search_queries_country BEFORE INSERT ON search_queries
      FOR EACH ROW EXECUTE FUNCTION country_from_cell();

    -- The language a message template is written in, so a French lead gets a French message.
    -- The templates written so far are French.
    ALTER TABLE message_templates ADD COLUMN language text NOT NULL DEFAULT 'fr'
      CHECK (language IN ('fr', 'ar', 'en', 'de', 'it'));
  `,
  down: /* sql */ `
    ALTER TABLE message_templates DROP COLUMN language;
    DROP TRIGGER search_queries_country ON search_queries;
    DROP TRIGGER exhausted_queries_country ON exhausted_queries;
    DROP TRIGGER region_coverage_country ON region_coverage;
    DROP TRIGGER region_cells_country ON region_cells;
    DROP TRIGGER runs_country ON runs;
    DROP TRIGGER companies_country ON companies;
    DROP FUNCTION country_from_cell_or_run();
    DROP FUNCTION country_from_cell();
    DROP FUNCTION country_from_region();
    DROP INDEX search_queries_country_idx;
    DROP INDEX companies_country_idx;
    DROP INDEX runs_country_idx;
    ALTER TABLE search_queries DROP COLUMN country;
    ALTER TABLE exhausted_queries DROP COLUMN country;
    ALTER TABLE region_coverage DROP COLUMN country;
    ALTER TABLE region_cells DROP COLUMN country;
    ALTER TABLE companies DROP COLUMN country;
    ALTER TABLE runs DROP COLUMN country;
  `,
};
