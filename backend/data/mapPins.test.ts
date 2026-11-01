import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from './companies.js';
import { removeCard } from './crmBoards.js';
import { upsertLead } from './crmLeads.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { listMapPins, MAP_PIN_LIMIT } from './mapPins.js';
import { createRun } from './runs.js';
import type { Sourced } from './sourced.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let user: UserId;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
});

const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://example.tn',
  fetchedAt: new Date('2026-10-01T10:00:00Z'),
  kind: 'fact',
});

async function addCompany(
  owner: UserId,
  name: string,
  governorate: string,
  where: { lat: number; lng: number } | null,
) {
  // A company takes its country from the run that found it.
  const run = await createRun(db, owner, { regionId: governorate, budgetCapUsd: 10 });
  return (
    await upsertCompany(
      db,
      owner,
      {
        name: fact(name),
        governorate: fact(governorate),
        googlePlaceId: fact(`place-${name}`),
        ...(where ? { location: where } : {}),
      },
      run.id,
    )
  ).company.id;
}

describe('listMapPins', () => {
  it('lists the companies that have a place, and only those', async () => {
    await addCompany(user, 'Alpha Huiles', 'sfax', { lat: 34.74, lng: 10.76 });
    await addCompany(user, 'Nowhere Ltd', 'sfax', null);
    const { items, total } = await listMapPins(db, user);
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Alpha Huiles',
      lat: 34.74,
      lng: 10.76,
      country: 'TN',
      regionId: 'sfax',
      runId: null,
      leadId: null,
      score: null,
    });
  });

  it('can be limited to one country', async () => {
    await addCompany(user, 'Alpha Huiles', 'sfax', { lat: 34.74, lng: 10.76 });
    await addCompany(user, 'Maison Breizh', 'fr-bretagne', { lat: 48.1, lng: -1.7 });
    expect((await listMapPins(db, user)).items.map((p) => p.country).sort()).toEqual(['FR', 'TN']);
    const fr = await listMapPins(db, user, 'FR');
    expect(fr.items.map((p) => p.name)).toEqual(['Maison Breizh']);
    expect(fr.total).toBe(1);
  });

  it('links a pin to its best lead, with the score', async () => {
    const companyId = await addCompany(user, 'Alpha Huiles', 'sfax', { lat: 34.74, lng: 10.76 });
    const run = await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 });
    await upsertLead(db, user, {
      runId: run.id,
      companyId,
      contactId: null,
      score: { companyFit: 40, contactFit: 20, reachability: 15 },
    });
    const [pin] = (await listMapPins(db, user)).items;
    expect(pin).toMatchObject({ runId: run.id, score: 75, stage: 'found' });
    expect(pin!.leadId).toEqual(expect.any(String));
  });

  it('leaves out companies removed to Noise, and brings them back when restored', async () => {
    const companyId = await addCompany(user, 'Alpha Huiles', 'sfax', { lat: 34.74, lng: 10.76 });
    const run = await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 });
    await upsertLead(db, user, {
      runId: run.id,
      companyId,
      contactId: null,
      score: { companyFit: 40, contactFit: 20, reachability: 15 },
    });
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM crm_cards WHERE user_id = $1 AND pipeline = 'companies'`,
      [user],
    );
    await removeCard(db, user, rows[0]!.id);
    expect((await listMapPins(db, user)).items).toEqual([]);
  });

  it('never shows another user a pin', async () => {
    const other = await makeUser(db);
    await addCompany(other, 'Theirs', 'sfax', { lat: 34.7, lng: 10.7 });
    await addCompany(user, 'Mine', 'sfax', { lat: 34.8, lng: 10.8 });
    expect((await listMapPins(db, user)).items.map((p) => p.name)).toEqual(['Mine']);
    expect((await listMapPins(db, other)).items.map((p) => p.name)).toEqual(['Theirs']);
  });

  it('stops at the limit and says how many there are in all', async () => {
    const extra = 7;
    await db.query(
      `INSERT INTO companies (user_id, name, normalized_name, governorate, lat, lng)
       SELECT $1, 'Bulk ' || n, 'bulk ' || n, 'sfax', 34 + (n % 100) / 1000.0, 10 + (n % 100) / 1000.0
         FROM generate_series(1, $2::int) AS n`,
      [user, MAP_PIN_LIMIT + extra],
    );
    const { items, total } = await listMapPins(db, user);
    expect(items).toHaveLength(MAP_PIN_LIMIT);
    expect(total).toBe(MAP_PIN_LIMIT + extra);
  });
});
