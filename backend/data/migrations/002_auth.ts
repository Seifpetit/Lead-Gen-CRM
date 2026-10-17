import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '002_auth',
  up: /* sql */ `
    -- Server-side sessions. Only a SHA-256 hash of the cookie token is stored, so a database
    -- leak does not leak live sessions.
    CREATE TABLE sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX sessions_user_idx ON sessions (user_id);
    CREATE INDEX sessions_expires_idx ON sessions (expires_at);

    -- Failed sign-ins, for rate limiting and lockout. Keyed by the email as typed (lowercased),
    -- whether or not an account exists, so responses don't reveal which emails are registered.
    CREATE TABLE login_failures (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      ip text NOT NULL,
      failed_at timestamptz NOT NULL
    );
    CREATE INDEX login_failures_email_idx ON login_failures (email, failed_at);
    CREATE INDEX login_failures_ip_idx ON login_failures (ip, failed_at);

    -- One-time invite codes for invite-only sign-up. Only the hash is stored.
    CREATE TABLE invites (
      code_hash text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      used_by uuid REFERENCES users (id) ON DELETE SET NULL
    );
  `,
  down: /* sql */ `
    DROP TABLE invites;
    DROP TABLE login_failures;
    DROP TABLE sessions;
  `,
};
