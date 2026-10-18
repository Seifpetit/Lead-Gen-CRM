import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '006_anthropic_provider',
  up: /* sql */ `
    -- Claude classifier calls are billed by Anthropic; 'llm' stays valid for older rows.
    ALTER TABLE cost_ledger DROP CONSTRAINT cost_ledger_provider_check;
    ALTER TABLE cost_ledger
      ADD CONSTRAINT cost_ledger_provider_check
      CHECK (provider IN ('apify', 'google', 'llm', 'anthropic'));
  `,
  // Fails if 'anthropic' rows exist: the ledger is append-only, so they cannot be removed.
  down: /* sql */ `
    ALTER TABLE cost_ledger DROP CONSTRAINT cost_ledger_provider_check;
    ALTER TABLE cost_ledger
      ADD CONSTRAINT cost_ledger_provider_check CHECK (provider IN ('apify', 'google', 'llm'));
  `,
};
