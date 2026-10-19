import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '012_run_live',
  up: /* sql */ `
    -- The latest plain sentence about what a run is doing ("Searching Google Maps for olive
    -- oil companies in Ben Arous..."). The same sentences are also appended to run_log.
    ALTER TABLE runs ADD COLUMN live_message text;

    -- Every line of a run's log: the live sentences and the technical detail behind them. Lines
    -- are redacted before they are written. apify_events keeps the provider's state history.
    CREATE TABLE run_log (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      run_step_id uuid REFERENCES run_steps (id) ON DELETE SET NULL,
      level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
      technical boolean NOT NULL DEFAULT false,
      message text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX run_log_run_idx ON run_log (run_id, id);

    -- Runs from before this migration: their provider events become technical log lines.
    INSERT INTO run_log (user_id, run_id, run_step_id, level, technical, message, occurred_at)
    SELECT e.user_id, e.run_id, e.run_step_id,
           CASE e.state WHEN 'failed' THEN 'error' WHEN 'restarting' THEN 'warn' ELSE 'info' END,
           true,
           'Apify run ' || e.apify_run_id || ' ' || e.state
             || CASE WHEN e.message IS NULL THEN '' ELSE ': ' || e.message END,
           e.occurred_at
      FROM apify_events e
     ORDER BY e.occurred_at, e.id;
  `,
  down: /* sql */ `
    DROP TABLE run_log;
    ALTER TABLE runs DROP COLUMN live_message;
  `,
};
