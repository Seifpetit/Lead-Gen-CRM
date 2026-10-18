import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { MIGRATIONS, migrateDown, migrateUp } from './migrate.js';
import { openTestDb } from './testDb.js';

let db: Db;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

async function tables(): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

describe('migrations', () => {
  it('creates every entity table and view', async () => {
    expect(await tables()).toEqual([
      'apify_events',
      'cell_claims',
      'companies',
      'contacts',
      'cost_ledger',
      'crm_leads',
      'evidence',
      'exhausted_queries',
      'invites',
      'login_failures',
      'region_cells',
      'region_coverage',
      'region_coverage_rollup',
      'region_status',
      'regions',
      'run_companies',
      'run_steps',
      'runs',
      'search_queries',
      'sessions',
      'suppression_list',
      'user_budget',
      'users',
    ]);
  });

  it('is a no-op when already applied', async () => {
    expect(await migrateUp(db)).toEqual([]);
  });

  it('rolls back cleanly and re-applies', async () => {
    expect(await migrateDown(db, Infinity)).toEqual(MIGRATIONS.map((m) => m.id).reverse());
    expect(await tables()).toEqual([]);
    expect(await migrateUp(db)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await tables()).toHaveLength(23);
  });
});
