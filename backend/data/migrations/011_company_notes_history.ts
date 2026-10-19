import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '011_company_notes_history',
  up: /* sql */ `
    -- A free-text note per company, written on the company's page.
    ALTER TABLE companies
      ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000);

    -- Every stage a card has been in, oldest first: the history shown on the company's page.
    -- A trigger writes it, so every way a card can be created or moved is covered.
    CREATE TABLE crm_card_events (
      id bigserial PRIMARY KEY,
      card_id uuid NOT NULL REFERENCES crm_cards (id) ON DELETE CASCADE,
      from_stage text,
      to_stage text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX crm_card_events_card_idx ON crm_card_events (card_id, at, id);

    CREATE FUNCTION crm_card_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO crm_card_events (card_id, from_stage, to_stage, at)
        VALUES (NEW.id, NULL, NEW.stage, NEW.created_at);
      ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
        INSERT INTO crm_card_events (card_id, from_stage, to_stage, at)
        VALUES (NEW.id, OLD.stage, NEW.stage, now());
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER crm_cards_event
      AFTER INSERT OR UPDATE OF stage ON crm_cards
      FOR EACH ROW EXECUTE FUNCTION crm_card_event();

    -- Cards that exist now start their history in the stage they are in.
    INSERT INTO crm_card_events (card_id, from_stage, to_stage, at)
    SELECT id, NULL, stage, stage_entered_at FROM crm_cards;
  `,
  down: /* sql */ `
    DROP TRIGGER crm_cards_event ON crm_cards;
    DROP FUNCTION crm_card_event();
    DROP TABLE crm_card_events;
    ALTER TABLE companies DROP COLUMN notes;
  `,
};
