import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '007_first_run_fixes',
  up: /* sql */ `
    -- Companies with no phone, website or email are kept, as 'unreachable', and never scored.
    ALTER TABLE run_companies DROP CONSTRAINT run_companies_state_check;
    ALTER TABLE run_companies
      ADD CONSTRAINT run_companies_state_check CHECK (state IN ('discovered', 'qualified',
        'rejected', 'review', 'people_found', 'enriched', 'verified', 'scored', 'skipped',
        'unreachable'));

    -- The company phone in E.164, for matching the same business across searches; foreign
    -- numbers (any code but +216) are kept and flagged.
    ALTER TABLE companies ADD COLUMN phone_e164 text;
    ALTER TABLE companies ADD COLUMN phone_foreign boolean NOT NULL DEFAULT false;
    CREATE INDEX companies_phone_e164_idx ON companies (user_id, phone_e164)
      WHERE phone_e164 IS NOT NULL;

    -- Why each score point was given (reason, evidence, fact or estimate).
    ALTER TABLE crm_leads ADD COLUMN score_reasons jsonb NOT NULL DEFAULT '[]';
  `,
  down: /* sql */ `
    -- The old constraint has no 'unreachable'; those rows become 'skipped' (kept, never scored).
    UPDATE run_companies SET state = 'skipped' WHERE state = 'unreachable';
    ALTER TABLE crm_leads DROP COLUMN score_reasons;
    DROP INDEX companies_phone_e164_idx;
    ALTER TABLE companies DROP COLUMN phone_foreign;
    ALTER TABLE companies DROP COLUMN phone_e164;
    ALTER TABLE run_companies DROP CONSTRAINT run_companies_state_check;
    ALTER TABLE run_companies
      ADD CONSTRAINT run_companies_state_check CHECK (state IN ('discovered', 'qualified',
        'rejected', 'review', 'people_found', 'enriched', 'verified', 'scored', 'skipped'));
  `,
};
