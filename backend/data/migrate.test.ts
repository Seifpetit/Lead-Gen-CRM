import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { MIGRATIONS, migrateDown, migrateUp } from './migrate.js';
import { createRun } from './runs.js';
import { seedReference } from './seed.js';
import { makeUser, openTestDb } from './testDb.js';

let db: Db;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

/** A company row as the old schema had it: written by hand, since the app now writes newer columns. */
async function oldCompany(userId: string, name: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO companies (user_id, name, normalized_name, governorate)
       VALUES ($1, $2, lower($2), 'sfax') RETURNING id`,
      [userId, name],
    )
  ).rows[0]!.id;
}

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
      'app_errors',
      'cell_claims',
      'companies',
      'contacts',
      'cost_ledger',
      'coverage_history',
      'crm_card_events',
      'crm_cards',
      'crm_contact_events',
      'crm_leads',
      'evidence',
      'exhausted_queries',
      'invites',
      'login_failures',
      'message_templates',
      'noise_markers',
      'pipeline_stages',
      'pipelines',
      'provider_health',
      'region_cells',
      'region_coverage',
      'region_coverage_rollup',
      'region_status',
      'regions',
      'run_companies',
      'run_log',
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
    expect(await tables()).toHaveLength(34);
  });

  it('moves existing leads onto the Companies board in Found, one card per company', async () => {
    await migrateDown(db, 8); // back to 008, before the boards
    expect(await tables()).not.toContain('crm_cards');
    await seedReference(db, {});
    const user = await makeUser(db);
    const other = await makeUser(db);
    const company = (u: typeof user, name: string) => oldCompany(u, name);
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

    expect(await migrateUp(db)).toEqual([
      '009_crm_boards',
      '010_board_images',
      '011_company_notes_history',
      '012_run_live',
      '013_company_place',
      '014_failure_tracking',
      '015_messages_contacts',
      '016_import_export',
    ]);
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
    // Each card starts its history where it stands.
    expect(
      (
        await db.query(
          "SELECT 1 FROM crm_card_events WHERE from_stage IS NULL AND to_stage = 'found'",
        )
      ).rowCount,
    ).toBe(3);
    // The leads themselves are untouched, and the People board starts empty.
    expect((await db.query('SELECT 1 FROM crm_leads')).rowCount).toBe(4);
    expect((await db.query("SELECT 1 FROM crm_cards WHERE pipeline = 'people'")).rowCount).toBe(0);
  });
  it('gives companies found before 013 their coordinates, category and address from the stored place', async () => {
    await migrateDown(db, 4); // back to 012, before the place columns
    await seedReference(db, {});
    const user = await makeUser(db);
    const run = await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 2 });
    const add = async (name: string, place: object | null) => {
      const id = await oldCompany(user, name);
      await db.query(
        `INSERT INTO run_companies (run_id, company_id, user_id, is_new, state, payload)
         VALUES ($1, $2, $3, true, 'discovered', $4)`,
        [run.id, id, user, JSON.stringify(place ? { place } : {})],
      );
      return id;
    };
    const full = await add('Full', {
      location: { lat: 34.74, lng: 10.76 },
      category: { value: 'Corporate office' },
      address: { value: 'Route de Tunis, 3000 Sfax, Tunisia' },
    });
    const noPlace = await add('Typed by hand', null);
    const badLocation = await add('Out of range', { location: { lat: 999, lng: 10 } });

    expect(await migrateUp(db)).toEqual([
      '013_company_place',
      '014_failure_tracking',
      '015_messages_contacts',
      '016_import_export',
    ]);
    const read = async (id: string) =>
      (await db.query('SELECT lat, lng, category, address FROM companies WHERE id = $1', [id]))
        .rows[0];
    expect(await read(full)).toEqual({
      lat: 34.74,
      lng: 10.76,
      category: 'Corporate office',
      address: 'Route de Tunis, 3000 Sfax, Tunisia',
    });
    expect(await read(noPlace)).toEqual({ lat: null, lng: null, category: null, address: null });
    // A coordinate that cannot be real is left out rather than failing the migration.
    expect(await read(badLocation)).toEqual({
      lat: null,
      lng: null,
      category: null,
      address: null,
    });
  });

  it('016 keeps old leads and old coverage: nothing deleted, old rows become history', async () => {
    await migrateDown(db, 1); // back to 015, before the import/export target
    await seedReference(db, {});
    const user = await makeUser(db);
    const run = await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 2 });
    const company = await oldCompany(user, 'Old mover');
    const cell = await db.query<{ id: string }>(
      `INSERT INTO region_cells (region_id, cell_key, south, west, north, east)
       VALUES ('sfax', 'r0c0', 34, 10, 35, 11) RETURNING id`,
    );
    await db.query(
      `INSERT INTO search_queries (user_id, run_id, region_cell_id, provider, query_text, normalized_query)
       VALUES ($1, $2, $3, 'apify_google_maps', 'transport de marchandises', 'transport de marchandises')`,
      [user, run.id, cell.rows[0]!.id],
    );
    await db.query(
      'INSERT INTO region_coverage (user_id, region_cell_id, places_found) VALUES ($1, $2, 7)',
      [user, cell.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO exhausted_queries (user_id, region_cell_id, normalized_query) VALUES ($1, $2, 'transport')`,
      [user, cell.rows[0]!.id],
    );

    expect(await migrateUp(db)).toEqual(['016_import_export']);

    // The company is still there, unlabelled.
    const c = await db.query('SELECT trade_role FROM companies WHERE id = $1', [company]);
    expect(c.rows).toEqual([{ trade_role: null }]);
    // The old search stays, tagged as the first query set; scoring starts at version 1.
    const q = await db.query('SELECT query_set FROM search_queries');
    expect(q.rows).toEqual([{ query_set: 1 }]);
    // The live coverage tables start clean; the old numbers are kept as history.
    expect((await db.query('SELECT 1 FROM region_coverage')).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM exhausted_queries')).rowCount).toBe(0);
    const history = await db.query<{ kind: string; query_set: number; places: number | null }>(
      `SELECT kind, query_set, (data ->> 'places_found')::integer AS places
         FROM coverage_history ORDER BY kind`,
    );
    expect(history.rows).toEqual([
      { kind: 'exhausted_queries', query_set: 1, places: null },
      { kind: 'region_coverage', query_set: 1, places: 7 },
    ]);
    // A hand-made label outside the allowed ones is refused.
    await expect(
      db.query("UPDATE companies SET trade_role = 'shipper' WHERE id = $1", [company]),
    ).rejects.toThrow();
  });

  it('turns the provider events of runs from before the live log into technical log lines', async () => {
    await migrateDown(db, 5); // back to 011, before run_log
    expect(await tables()).not.toContain('run_log');
    await seedReference(db, {});
    const user = await makeUser(db);
    const run = await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 2 });
    const step = (
      await db.query<{ id: string }>(
        `INSERT INTO run_steps (user_id, run_id, stage, step_key)
         VALUES ($1, $2, 'discover', 'cell-1') RETURNING id`,
        [user, run.id],
      )
    ).rows[0]!.id;
    const event = (state: string, message: string | null, at: string) =>
      db.query(
        `INSERT INTO apify_events (user_id, run_id, run_step_id, apify_run_id, state, message, occurred_at)
         VALUES ($1, $2, $3, 'apify-1', $4, $5, $6)`,
        [user, run.id, step, state, message, at],
      );
    await event('started', null, '2026-10-18T09:00:00Z');
    await event('restarting', 'ran out of memory', '2026-10-18T09:01:00Z');
    await event('failed', 'gave up', '2026-10-18T09:02:00Z');

    expect(await migrateUp(db)).toEqual([
      '012_run_live',
      '013_company_place',
      '014_failure_tracking',
      '015_messages_contacts',
      '016_import_export',
    ]);
    const { rows } = await db.query<{
      level: string;
      technical: boolean;
      message: string;
      run_step_id: string;
    }>('SELECT level, technical, message, run_step_id FROM run_log ORDER BY id');
    expect(rows).toEqual([
      { level: 'info', technical: true, message: 'Apify run apify-1 started', run_step_id: step },
      {
        level: 'warn',
        technical: true,
        message: 'Apify run apify-1 restarting: ran out of memory',
        run_step_id: step,
      },
      {
        level: 'error',
        technical: true,
        message: 'Apify run apify-1 failed: gave up',
        run_step_id: step,
      },
    ]);
    expect((await db.query('SELECT live_message FROM runs')).rows[0]).toEqual({
      live_message: null,
    });
  });
});
