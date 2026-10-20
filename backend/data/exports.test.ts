import { EXPORT_MAX_ROWS } from '@lead-gen-crm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { cardExportRows, leadExportRows } from './exports.js';
import type { UserId } from './ids.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let user: UserId;
let other: UserId;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

/** n companies in Found, each with a lead; half textile, scores 20/30/40, phones mobile or not. */
async function seed(owner: UserId, n: number) {
  await db.query(
    `INSERT INTO companies (user_id, name, normalized_name, governorate, sector, website, phone, address)
     SELECT $1, 'Société ' || lpad(i::text, 5, '0'), 'societe ' || lpad(i::text, 5, '0'), 'sfax',
            CASE WHEN i % 2 = 0 THEN 'textile' ELSE 'olive-oil' END,
            'https://co' || i || '.tn',
            CASE WHEN i % 2 = 0 THEN '+216 98 ' || lpad((i % 1000)::text, 3, '0') || ' 456'
                 ELSE '74 123 456' END,
            'Route de Tunis, 3000 Sfax, Tunisia'
       FROM generate_series(1, $2::int) i`,
    [owner, n],
  );
  await db.query(
    `INSERT INTO crm_cards (user_id, pipeline, stage, company_id)
     SELECT user_id, 'companies', 'found', id FROM companies WHERE user_id = $1`,
    [owner],
  );
  await db.query(
    `INSERT INTO crm_leads (user_id, company_id, score_company_fit, score_contact_fit, score_reachability)
     SELECT user_id, id, 5 + (right(name, 5)::int % 3) * 10, 10, 5 FROM companies WHERE user_id = $1`,
    [owner],
  );
}

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  other = await makeUser(db);
});

describe('cardExportRows', () => {
  it('follows the filters and writes each card as a row without ids', async () => {
    await seed(user, 30);
    const all = await cardExportRows(db, user, 'companies', 30, { excludeNoise: true });
    expect(all.rows).toHaveLength(30);
    expect(all.total).toBe(30);
    const textile = await cardExportRows(db, user, 'companies', 30, { sector: 'textile' });
    expect(textile.rows).toHaveLength(15);
    expect(textile.rows.every((r) => r.sector === 'Textile and clothing')).toBe(true);
    const best = await cardExportRows(db, user, 'companies', 30, { minScore: 40 });
    expect(best.rows).toHaveLength(10);
    const one = await cardExportRows(db, user, 'companies', 30, { q: 'Société 00007' });
    expect(one.rows).toEqual([
      {
        company: 'Société 00007',
        person: null,
        role: null,
        sector: 'Olive oil',
        city: 'Sfax',
        phone: '74 123 456',
        whatsapp: false,
        email: null,
        website: 'https://co7.tn',
        score: 30,
        stage: 'Found',
        foundAt: expect.any(String),
        mapsUrl:
          'https://www.google.com/maps/search/?api=1&query=Soci%C3%A9t%C3%A9%2000007%2C%20Sfax',
      },
    ]);
    // A mobile number can be opened in WhatsApp.
    expect(
      (await cardExportRows(db, user, 'companies', 30, { q: 'Société 00008' })).rows[0],
    ).toMatchObject({ whatsapp: true });
  });

  it('never includes another user’s cards', async () => {
    await seed(user, 5);
    expect((await cardExportRows(db, other, 'companies', 30, {})).rows).toEqual([]);
  });

  it('reads a large set page by page, in the chosen order, and stops at the limit', async () => {
    await seed(user, 1234);
    const out = await cardExportRows(db, user, 'companies', 30, { sort: 'name', dir: 'asc' });
    expect(out.rows).toHaveLength(1234);
    expect(new Set(out.rows.map((r) => r.company)).size).toBe(1234);
    expect(out.rows[0]!.company).toBe('Société 00001');
    expect(out.rows[1233]!.company).toBe('Société 01234');
    const capped = await cardExportRows(db, user, 'companies', 30, {}, 250);
    expect(capped.rows).toHaveLength(250);
    expect(capped.total).toBe(1234);
    expect(EXPORT_MAX_ROWS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('leadExportRows', () => {
  it('lists the leads best first, follows the filters and is scoped to the user', async () => {
    await seed(user, 12);
    await seed(other, 3);
    const all = await leadExportRows(db, user, {});
    expect(all.rows).toHaveLength(12);
    expect(all.rows[0]!.score).toBe(40);
    expect(all.rows.at(-1)!.score).toBe(20);
    expect(all.rows[0]!.stage).toBe('Suggested');
    expect((await leadExportRows(db, user, { minScore: 30 })).rows).toHaveLength(8);
    expect((await leadExportRows(db, user, { q: '00003' })).rows).toHaveLength(1);
    expect(
      (await leadExportRows(db, user, { runIds: ['00000000-0000-4000-8000-000000000000'] })).rows,
    ).toEqual([]);
    expect((await leadExportRows(db, other, {})).rows).toHaveLength(3);
  });

  it('pages through a large set and stops at the limit', async () => {
    await seed(user, 1100);
    expect((await leadExportRows(db, user, {})).rows).toHaveLength(1100);
    const capped = await leadExportRows(db, user, {}, 600);
    expect(capped.rows).toHaveLength(600);
    expect(capped.total).toBe(1100);
  });
});
