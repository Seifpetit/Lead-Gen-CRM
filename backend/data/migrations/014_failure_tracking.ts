import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '014_failure_tracking',
  up: /* sql */ `
    -- Every distinct failure the app met, once, with how often it came back. The message and the
    -- stack summary are masked (lib/redact.ts) before they are written. user_id is null for
    -- failures that belong to no one (startup, migrations, an unauthenticated webhook).
    CREATE TABLE app_errors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users (id) ON DELETE CASCADE,
      run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
      source text NOT NULL,
      provider text,
      step text,
      kind text NOT NULL,
      message text NOT NULL,
      stack text,
      fingerprint text NOT NULL,
      count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
      first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now()
    );
    -- One row per user and fingerprint; NULL users share one slot.
    CREATE UNIQUE INDEX app_errors_fingerprint_idx
      ON app_errors (COALESCE(user_id::text, ''), fingerprint);
    CREATE INDEX app_errors_last_seen_idx ON app_errors (last_seen DESC);

    -- Whether each provider answers, as the last calls found it. One row per provider for the
    -- whole install: the keys are the server's, not a user's.
    CREATE TABLE provider_health (
      provider text PRIMARY KEY,
      state text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'degraded', 'down')),
      kind text,
      reason text,
      consecutive_failures integer NOT NULL DEFAULT 0,
      since timestamptz,
      last_ok_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- What is wrong with a run in progress ({kind, message, since, action}), set by the
    -- watchdog and the orchestrator, cleared when it passes.
    ALTER TABLE runs ADD COLUMN problem jsonb;
  `,
  down: /* sql */ `
    ALTER TABLE runs DROP COLUMN problem;
    DROP TABLE provider_health;
    DROP TABLE app_errors;
  `,
};
