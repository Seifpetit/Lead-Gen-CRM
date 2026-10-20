import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '015_messages_contacts',
  up: /* sql */ `
    -- Message templates, per user: a name and a text with {variables}. The three defaults are
    -- written the first time a user opens their templates (templates_seeded remembers that, so
    -- deleting them all does not bring them back).
    CREATE TABLE message_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX message_templates_user_idx ON message_templates (user_id, position, created_at);

    -- Who the messages come from ({my_name}, {my_company}).
    ALTER TABLE users
      ADD COLUMN sender_name text NOT NULL DEFAULT '' CHECK (char_length(sender_name) <= 120),
      ADD COLUMN sender_company text NOT NULL DEFAULT '' CHECK (char_length(sender_company) <= 120),
      ADD COLUMN templates_seeded boolean NOT NULL DEFAULT false;

    -- Each time someone opened a conversation with a card's contact from the app (WhatsApp).
    -- Nothing is sent from here: this only says the app was used to open it.
    CREATE TABLE crm_contact_events (
      id bigserial PRIMARY KEY,
      card_id uuid NOT NULL REFERENCES crm_cards (id) ON DELETE CASCADE,
      channel text NOT NULL CHECK (channel IN ('whatsapp')),
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX crm_contact_events_card_idx ON crm_contact_events (card_id, at DESC);
  `,
  down: /* sql */ `
    DROP TABLE crm_contact_events;
    ALTER TABLE users
      DROP COLUMN templates_seeded,
      DROP COLUMN sender_company,
      DROP COLUMN sender_name;
    DROP TABLE message_templates;
  `,
};
