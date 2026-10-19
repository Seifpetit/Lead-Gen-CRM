import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { MIGRATIONS, migrateDown, migrateUp } from './migrate.js';
import { upsertCompany } from './companies.js';
import { seedReference } from './seed.js';
import { makeUser, openTestDb } from './testDb.js';

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
      'crm_cards',
      'crm_leads',
      'evidence',
      'exhausted_queries',
      'invites',
      'login_failures',
      'noise_markers',
      'pipeline_stages',
      'pipelines',
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
    expect(await tables()).toHaveLength(27);
  });

  it('moves existing leads onto the Companies board in Found, one card per company', async () => {
    await migrateDown(db, 1); // back to 008, before the boards
    expect(await tables()).not.toContain('crm_cards');
    await seedReference(db, {});
    const user = await makeUser(db);
    const other = await makeUser(db);
    const src = { sourceUrl: 'https://example.tn', fetchedAt: new Date(), kind: 'fact' as const };
    const company = async (u: typeof user, name: string) =>
      (
        await upsertCompany(db, u, {
          name: { ...src, value: name },
          governorate: { ...src, value: 'sfax' },
        })
      ).company.id;
    const [a, b, c, noLead] = [
      await company(user, 'Alpha'),
      await company(user, 'Beta'),
      await company(other, 'Gamma'),
      await company(user, 'No lead'),
    ];
    const lead = (u: typeof user, companyId: string, contactId: string | null, stage: string) =>
      db.query(
        `INSERT INTO crm_leads (user_id, company_id, contact_id, stage, score_company_fit, score_contact_fit, score_reachability)
         VALUES ($1, $2, $3, $4, 40, 20, 10)`,
        [u, companyId, contactId, stage],
      );
    await lead(user, a, null, 'system_suggested');
    await lead(user, a, null, 'dismissed').catch(() => null); // duplicate pair: refused, as before
    const contact = (
      await db.query<{ id: string }>(
        "INSERT INTO contacts (user_id, company_id, full_name) VALUES ($1, $2, 'Amel') RETURNING id",
        [user, a],
      )
    ).rows[0]!.id;
    await lead(user, a, contact, 'dismissed');
    await lead(user, b, null, 'opted_out');
    await lead(other, c, null, 'confirmed');

    expect(await migrateUp(db)).toEqual(['009_crm_boards']);
    const { rows } = await db.query<{
      user_id: string;
      company_id: string;
      pipeline: string;
      stage: string;
      contact_id: string | null;
      noise_at: Date | null;
    }>(
      'SELECT user_id, company_id, pipeline, stage, contact_id, noise_at FROM crm_cards ORDER BY company_id',
    );
    expect(rows.map((r) => r.company_id).sort()).toEqual([a, b, c].sort());
    for (const r of rows) {
      expect(r).toMatchObject({
        pipeline: 'companies',
        stage: 'found',
        contact_id: null,
        noise_at: null,
      });
    }
    expect(rows.find((r) => r.company_id === c)!.user_id).toBe(other);
    expect(rows.some((r) => r.company_id === noLead)).toBe(false);
    // The leads themselves are untouched, and the People board starts empty.
    expect((await db.query('SELECT 1 FROM crm_leads')).rowCount).toBe(4);
    expect((await db.query("SELECT 1 FROM crm_cards WHERE pipeline = 'people'")).rowCount).toBe(0);
  });
});
