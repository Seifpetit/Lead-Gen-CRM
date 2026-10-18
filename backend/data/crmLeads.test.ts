import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from './companies.js';
import { upsertContact } from './contacts.js';
import { getLead, listLeads, moveLead, upsertLead } from './crmLeads.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { createRun } from './runs.js';
import type { Sourced } from './sourced.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let user: UserId;
let companyId: string;
let contactId: string;
let runId: string;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://example.tn',
  fetchedAt: new Date('2026-10-01T10:00:00Z'),
  kind: 'fact',
});
const score = { companyFit: 40, contactFit: 20, reachability: 15 };

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
  companyId = (await upsertCompany(db, user, { name: fact('Alpha'), governorate: fact('sfax') }))
    .company.id;
  contactId = (await upsertContact(db, user, { companyId, fullName: fact('Amine') })).contact.id;
});

describe('crm leads', () => {
  it('starts in system_suggested and moves through every stage', async () => {
    const { lead } = (await upsertLead(db, user, { runId, companyId, contactId, score }))!;
    expect(lead).toMatchObject({ stage: 'system_suggested', score: { ...score, total: 75 } });
    for (const stage of [
      'confirmed',
      'contacted',
      'response',
      'won',
      'lost',
      'dismissed',
      'opted_out',
    ] as const) {
      expect((await moveLead(db, user, lead.id, stage))?.stage).toBe(stage);
    }
  });

  it('a dismissed lead stays dismissed when the pipeline finds it again', async () => {
    const { lead } = (await upsertLead(db, user, { runId, companyId, contactId, score }))!;
    await moveLead(db, user, lead.id, 'dismissed');
    const again = (await upsertLead(db, user, {
      runId,
      companyId,
      contactId,
      score: { ...score, reachability: 20 },
    }))!;
    expect(again).toMatchObject({ created: false, lead: { id: lead.id, stage: 'dismissed' } });
    expect(again.lead.score.total).toBe(80);
    expect(await listLeads(db, user, { stage: 'system_suggested' })).toEqual([]);
  });

  it('a company-only lead (no contact) is also unique', async () => {
    const a = (await upsertLead(db, user, { runId, companyId, contactId: null, score }))!;
    const b = (await upsertLead(db, user, { runId, companyId, contactId: null, score }))!;
    expect(b).toMatchObject({ created: false, lead: { id: a.lead.id } });
  });

  it('rejects scores outside their caps', async () => {
    await expect(
      upsertLead(db, user, {
        runId,
        companyId,
        contactId,
        score: { ...score, companyFit: 51 },
      }),
    ).rejects.toThrow();
  });

  it("cannot create, read or move another user's lead", async () => {
    const other = await makeUser(db);
    expect(await upsertLead(db, other, { runId, companyId, contactId, score })).toBeNull();
    const { lead } = (await upsertLead(db, user, { runId, companyId, contactId, score }))!;
    expect(await getLead(db, other, lead.id)).toBeNull();
    expect(await moveLead(db, other, lead.id, 'won')).toBeNull();
    expect((await getLead(db, user, lead.id))?.stage).toBe('system_suggested');
  });
});
