import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { upsertCompany } from '../data/companies.js';
import { removeCard } from '../data/crmBoards.js';
import { upsertLead } from '../data/crmLeads.js';
import type { Db } from '../data/db.js';
import { createRun } from '../data/runs.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import { startNoisePurge } from './noisePurge.js';

let db: Db;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(() => resetData(db));

it('purges old Noise cards when it starts and again on every interval', async () => {
  const user = await makeUser(db);
  const runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
  const src = { sourceUrl: 'https://example.tn', fetchedAt: new Date(), kind: 'fact' as const };
  const lead = async (name: string) => {
    const id = (
      await upsertCompany(db, user, {
        name: { ...src, value: name },
        governorate: { ...src, value: 'sfax' },
      })
    ).company.id;
    await upsertLead(db, user, {
      runId,
      companyId: id,
      contactId: null,
      score: { companyFit: 10, contactFit: 0, reachability: 5 },
    });
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM crm_cards WHERE company_id = $1',
      [id],
    );
    await removeCard(db, user, rows[0]!.id);
    return rows[0]!.id;
  };
  const old = await lead('Old');
  await db.query("UPDATE crm_cards SET noise_at = now() - interval '31 days' WHERE id = $1", [old]);
  const fresh = await lead('Fresh');

  const log = vi.fn();
  const stop = startNoisePurge(db, 30, log, 25);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.query('SELECT 1 FROM crm_cards WHERE id = $1', [old]);
      expect(rows).toEqual([]);
    });
    expect(log).toHaveBeenCalledWith({ people: 0, companies: 1 }, 'purged removed CRM cards');
    const { rows } = await db.query('SELECT 1 FROM crm_cards WHERE id = $1', [fresh]);
    expect(rows).toHaveLength(1);

    // A card that ages past the retention later is caught by the next run.
    await db.query("UPDATE crm_cards SET noise_at = now() - interval '31 days' WHERE id = $1", [
      fresh,
    ]);
    await vi.waitFor(async () => {
      expect((await db.query('SELECT 1 FROM crm_cards WHERE id = $1', [fresh])).rows).toEqual([]);
    });
  } finally {
    stop();
  }
});
