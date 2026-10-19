import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BoardError, listCards, loadBoard } from './crmBoards.js';
import type { Db } from './db.js';
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

const RETENTION = 30;

/** 120 companies in Found: three scores (many ties), two sectors, spread-out dates. */
async function seed(owner: UserId, n = 120) {
  await db.query(
    `INSERT INTO companies (user_id, name, normalized_name, governorate, sector, website)
     SELECT $1, 'Co ' || lpad(i::text, 3, '0'), 'co ' || lpad(i::text, 3, '0'), 'sfax',
            CASE WHEN i % 2 = 0 THEN 'textile' ELSE 'olive-oil' END,
            'https://co' || i || '.tn'
       FROM generate_series(1, $2::int) i`,
    [owner, n],
  );
  await db.query(
    `INSERT INTO crm_cards (user_id, pipeline, stage, company_id, stage_entered_at, created_at)
     SELECT user_id, 'companies', 'found', id,
            now() - (right(name, 3)::int || ' hours')::interval,
            now() - (right(name, 3)::int || ' minutes')::interval
       FROM companies WHERE user_id = $1`,
    [owner],
  );
  await db.query(
    `INSERT INTO crm_leads (user_id, company_id, score_company_fit, score_contact_fit, score_reachability)
     SELECT user_id, id, 20 + (right(name, 3)::int % 3) * 10, 10, 5 FROM companies WHERE user_id = $1`,
    [owner],
  );
}

async function walk(options: Parameters<typeof listCards>[4]) {
  const ids: string[] = [];
  const names: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await listCards(db, user, 'companies', RETENTION, {
      ...options,
      cursor,
      limit: 50,
    });
    pages++;
    ids.push(...page.cards.map((c) => c.id));
    names.push(...page.cards.map((c) => c.company.name));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { ids, names, pages };
}

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  other = await makeUser(db);
  await seed(user);
  await seed(other, 10);
});

describe('paging a column', () => {
  it('returns 50 cards with the real total, then the next 50, until everything is loaded', async () => {
    const first = await listCards(db, user, 'companies', RETENTION, { stage: 'found' });
    expect(first.cards).toHaveLength(50);
    expect(first.total).toBe(120);
    expect(first.nextCursor).toBeTruthy();
    const { ids, pages } = await walk({ stage: 'found' });
    expect(pages).toBe(3);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it('keeps pages exact when many cards share a score (ties break on the card id)', async () => {
    const { ids } = await walk({ stage: 'found', sort: 'score' });
    expect(new Set(ids).size).toBe(120);
    const scores = (
      await db.query<{ score: number }>(
        `SELECT max(l.score_total)::int AS score FROM crm_leads l WHERE l.user_id = $1
          GROUP BY l.company_id, l.id`,
        [user],
      )
    ).rows.map((r) => r.score);
    expect(new Set(scores)).toEqual(new Set([35, 45, 55]));
  });

  it('sorts newest, by days in stage, by name and by score, either way round', async () => {
    const names = async (sort: 'newest' | 'days' | 'name' | 'score', dir?: 'asc' | 'desc') =>
      (await walk({ stage: 'found', sort, ...(dir ? { dir } : {}) })).names;
    // Card age grows with the number in the name: Co 001 is the newest, Co 120 the oldest.
    const newest = await names('newest');
    expect(newest.slice(0, 2)).toEqual(['Co 001', 'Co 002']);
    // Days in stage: the longest in the stage first (Co 120 entered it longest ago).
    const days = await names('days');
    expect(days.slice(0, 2)).toEqual(['Co 120', 'Co 119']);
    expect((await names('days', 'desc')).slice(0, 1)).toEqual(['Co 001']);
    expect((await names('name')).slice(0, 2)).toEqual(['Co 001', 'Co 002']);
    expect((await names('name', 'desc')).slice(0, 1)).toEqual(['Co 120']);
    const best = (await listCards(db, user, 'companies', RETENTION, { sort: 'score', limit: 1 }))
      .cards[0]!;
    expect(best.score).toBe(55);
  });

  it('never shows another user the cards', async () => {
    const { ids } = await walk({ stage: 'found' });
    const theirs = (
      await db.query<{ id: string }>('SELECT id FROM crm_cards WHERE user_id = $1', [other])
    ).rows.map((r) => r.id);
    expect(ids.some((id) => theirs.includes(id))).toBe(false);
  });

  it('refuses an unknown column and a cursor that is not one of its own', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof BoardError ? e.code : 'other'),
      );
    expect(await code(listCards(db, user, 'companies', RETENTION, { stage: 'sold' }))).toBe(
      'invalid_stage',
    );
    expect(await code(listCards(db, user, 'companies', RETENTION, { cursor: 'junk' }))).toBe(
      'invalid_cursor',
    );
  });
});

describe('filters run on the server', () => {
  it('filters by search words, sector and minimum score, and the total follows', async () => {
    const q = await listCards(db, user, 'companies', RETENTION, { q: 'co 04', stage: 'found' });
    // "co 040" to "co 049".
    expect(q.total).toBe(10);
    expect(q.cards.every((c) => c.company.name.startsWith('Co 04'))).toBe(true);

    const site = await listCards(db, user, 'companies', RETENTION, { q: 'co77.tn' });
    expect(site.cards.map((c) => c.company.name)).toEqual(['Co 077']);

    const sector = await listCards(db, user, 'companies', RETENTION, { sector: 'textile' });
    expect(sector.total).toBe(60);
    expect(sector.cards.every((c) => c.company.sector === 'textile')).toBe(true);

    const high = await listCards(db, user, 'companies', RETENTION, { minScore: 50 });
    expect(high.total).toBe(40);
    expect(high.cards.every((c) => (c.score ?? 0) >= 50)).toBe(true);

    const both = await listCards(db, user, 'companies', RETENTION, {
      sector: 'olive-oil',
      minScore: 50,
      q: 'co 0',
    });
    expect(both.cards.every((c) => c.company.sector === 'olive-oil' && (c.score ?? 0) >= 50)).toBe(
      true,
    );
  });

  it('treats % and _ in the search as plain characters', async () => {
    expect((await listCards(db, user, 'companies', RETENTION, { q: '%' })).total).toBe(0);
    expect((await listCards(db, user, 'companies', RETENTION, { q: 'co_001' })).total).toBe(0);
  });

  it('puts the filtered true total on every column header, and lists the sectors', async () => {
    const board = await loadBoard(db, user, 'companies', RETENTION, { sector: 'textile' });
    expect(board.stages.map((s) => s.total)).toEqual([60, 0, 0, 0]);
    expect(board.stages[0]!.cards).toHaveLength(50);
    expect(board.stages[0]!.nextCursor).toBeTruthy();
    expect(board.sectors).toEqual([
      { id: 'olive-oil', name: 'Olive oil' },
      { id: 'textile', name: 'Textile and clothing' },
    ]);
  });

  it('can leave Noise out for the table view', async () => {
    await db.query(
      `UPDATE crm_cards SET stage = 'noise', noise_at = now(), noise_from_stage = 'found'
        WHERE id IN (SELECT id FROM crm_cards WHERE user_id = $1 LIMIT 5)`,
      [user],
    );
    const all = await listCards(db, user, 'companies', RETENTION, {});
    const active = await listCards(db, user, 'companies', RETENTION, { excludeNoise: true });
    expect([all.total, active.total]).toEqual([120, 115]);
  });
});
