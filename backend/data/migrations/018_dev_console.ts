import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '018_dev_console',
  up: /* sql */ `
    -- A developer-console call keeps its spend in the ledger like a run does, on a run of its own
    -- kind that is created finished. Runs lists, outcomes, coverage and lead counters only look at
    -- kind 'search', so these never show there.
    ALTER TABLE runs DROP CONSTRAINT runs_kind_check;
    ALTER TABLE runs ADD CONSTRAINT runs_kind_check
      CHECK (kind IN ('search', 'trade_check', 'dev_step'));

    -- What the console ran: its input, its output, what it cost. Debugging only; it points at no
    -- company, contact or lead.
    CREATE TABLE dev_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      step text NOT NULL CHECK (step IN ('discover', 'classify')),
      status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
      input jsonb NOT NULL,
      output jsonb,
      cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX dev_steps_user_idx ON dev_steps (user_id, step, created_at DESC);
  `,
  down: /* sql */ `
    DROP TABLE dev_steps;
    DELETE FROM runs WHERE kind = 'dev_step';
    ALTER TABLE runs DROP CONSTRAINT runs_kind_check;
    ALTER TABLE runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('search', 'trade_check'));
  `,
};
