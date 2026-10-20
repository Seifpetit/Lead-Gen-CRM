import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from './companies.js';
import { upsertContact } from './contacts.js';
import {
  correctCost,
  CostError,
  costPerLeadForCell,
  costPerLeadForRegion,
  costPerLeadForRun,
  listLedgerForRun,
  reconcileCost,
  recordCost,
  remainingBudget,
  settleStepCosts,
  type CostEntryInput,
} from './costLedger.js';
import { upsertLead } from './crmLeads.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { createRegionGrid } from './regionCells.js';
import { createRun, getRun, updateRun } from './runs.js';
import { ensureStep, listSteps } from './runSteps.js';
import type { Sourced } from './sourced.js';
import { makeUser, openTestDb, resetData } from './testDb.js';
import { getMonthlyBudget, setMonthlyCap } from './userBudget.js';

let db: Db;
let user: UserId;
let runId: string;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  user = await makeUser(db);
  runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
  await updateRun(db, user, runId, { status: 'running' });
});

const apify = (units: number, extra: Partial<CostEntryInput> = {}): CostEntryInput => ({
  runId,
  provider: 'apify',
  item: 'compass/crawler-google-places',
  units,
  unitPriceUsd: 0.004,
  kind: 'estimated',
  ...extra,
});
const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://example.tn',
  fetchedAt: new Date('2026-10-01T00:00:00Z'),
  kind: 'fact',
});

describe('cost ledger', () => {
  it('computes run and step spend from the ledger', async () => {
    const step = (await ensureStep(db, user, { runId, stage: 'discover', stepKey: 'k' }))!;
    const r = await recordCost(db, user, apify(500, { runStepId: step.id }));
    expect(r.entry).toMatchObject({ amountUsd: 2, kind: 'estimated', units: 500 });
    expect(r).toMatchObject({ runSpentUsd: 2, runBudgetCapUsd: 10, stoppedByCap: false });
    await recordCost(db, user, {
      ...apify(1),
      provider: 'llm',
      item: 'model-x',
      unitPriceUsd: 0.5,
    });
    // Open estimates are held in reserve; nothing is spent until a provider charges for it.
    expect(await getRun(db, user, runId)).toMatchObject({ spentUsd: 0, reservedUsd: 2.5 });
    expect((await listSteps(db, user, runId))[0]?.costUsd).toBe(2);
  });

  it("never lowers a run's spent figure when a step's estimate is swapped for its real charge", async () => {
    const step = (await ensureStep(db, user, { runId, stage: 'discover', stepKey: 'k2' }))!;
    await recordCost(db, user, apify(500, { runStepId: step.id }));
    const before = (await getRun(db, user, runId))!;
    expect(before).toMatchObject({ spentUsd: 0, reservedUsd: 2 });
    await settleStepCosts(db, user, {
      runId,
      runStepId: step.id,
      actuals: [{ provider: 'apify', item: 'x', units: 100, unitPriceUsd: 0.004 }],
    });
    const after = (await getRun(db, user, runId))!;
    expect(after.spentUsd).toBeGreaterThanOrEqual(before.spentUsd);
    expect(after).toMatchObject({ spentUsd: 0.4, reservedUsd: 0 });
  });

  it('refuses updates and deletes at the database level', async () => {
    const { entry } = await recordCost(db, user, apify(100));
    await expect(
      db.query('UPDATE cost_ledger SET amount_usd = 0 WHERE id = $1', [entry.id]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM cost_ledger WHERE id = $1', [entry.id])).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects an amount that is not units times unit price', async () => {
    await expect(
      db.query(
        `INSERT INTO cost_ledger (user_id, run_id, provider, item, units, unit_price_usd, amount_usd, kind)
         VALUES ($1, $2, 'apify', 'x', 10, 1, 5, 'actual')`,
        [user, runId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('corrects with an opposite row, once', async () => {
    const { entry } = await recordCost(db, user, apify(500));
    const c = await correctCost(db, user, entry.id);
    expect(c.entry).toMatchObject({ amountUsd: -2, units: -500, correctsId: entry.id });
    expect(c.runSpentUsd).toBe(0);
    await expect(correctCost(db, user, entry.id)).rejects.toThrow(CostError);
    await expect(correctCost(db, user, c.entry.id)).rejects.toThrow(CostError);
    expect(await listLedgerForRun(db, user, runId)).toHaveLength(2);
  });

  it('reconciles an estimate to the actual figure', async () => {
    const { entry } = await recordCost(db, user, apify(500));
    const r = await reconcileCost(db, user, entry.id, { units: 480, unitPriceUsd: 0.004 });
    expect(r.entry).toMatchObject({ kind: 'actual', amountUsd: 1.92 });
    expect(r.entry.reconciledAt).not.toBeNull();
    expect(r.runSpentUsd).toBe(1.92);
    const kinds = (await listLedgerForRun(db, user, runId)).map((e) => [e.kind, e.amountUsd]);
    expect(kinds).toEqual([
      ['estimated', 2],
      ['estimated', -2],
      ['actual', 1.92],
    ]);
    await expect(
      reconcileCost(db, user, r.entry.id, { units: 1, unitPriceUsd: 1 }),
    ).rejects.toThrow(CostError);
  });

  it("refuses costs on another user's run", async () => {
    const other = await makeUser(db);
    await expect(recordCost(db, other, apify(1))).rejects.toThrow(CostError);
  });
});

describe('caps', () => {
  it('stops the run when its budget cap is reached, and still records later costs', async () => {
    expect((await recordCost(db, user, apify(2000))).stoppedByCap).toBe(false); // $8
    expect(await remainingBudget(db, user, runId)).toBeCloseTo(2);
    const hit = await recordCost(db, user, apify(500)); // $10
    expect(hit).toMatchObject({ runSpentUsd: 10, stoppedByCap: true });
    expect((await getRun(db, user, runId))?.status).toBe('stopped_by_cap');
    expect(await remainingBudget(db, user, runId)).toBe(0);
    const late = await recordCost(db, user, apify(10));
    expect(late).toMatchObject({ stoppedByCap: false, runSpentUsd: 10.04 });
  });

  it('stops a run when the monthly cap is reached across runs', async () => {
    const now = new Date();
    await setMonthlyCap(db, user, now, 5);
    const run2 = (await createRun(db, user, { regionId: 'sousse', budgetCapUsd: 100 })).id;
    await updateRun(db, user, run2, { status: 'running' });
    await recordCost(db, user, apify(750)); // $3 on run 1
    expect(await remainingBudget(db, user, run2, now)).toBeCloseTo(2);
    const hit = await recordCost(db, user, apify(500, { runId: run2 })); // $2 on run 2: month at $5
    expect(hit).toMatchObject({ stoppedByCap: true, monthSpentUsd: 5, monthCapUsd: 5 });
    expect(await getMonthlyBudget(db, user, now)).toMatchObject({ capUsd: 5, spentUsd: 5 });
    const other = await makeUser(db);
    expect(await getMonthlyBudget(db, other, now)).toMatchObject({ capUsd: null, spentUsd: 0 });
  });
});

describe('cost per lead and run attribution', () => {
  it('computes per run, region and cell, keeping the first run on re-found records', async () => {
    const [cellA, cellB] = await createRegionGrid(
      db,
      'sfax',
      { south: 34, west: 10, north: 35, east: 11 },
      1,
      2,
    );
    const run2 = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
    const a = await upsertCompany(
      db,
      user,
      { name: fact('Alpha'), governorate: fact('sfax'), regionCellId: cellA!.id },
      runId,
    );
    const b = await upsertCompany(
      db,
      user,
      { name: fact('Beta'), governorate: fact('sfax'), regionCellId: cellB!.id },
      run2,
    );
    const contact = await upsertContact(
      db,
      user,
      { companyId: a.company.id, fullName: fact('Amine'), linkedinPublicId: fact('amine') },
      runId,
    );
    const score = { companyFit: 30, contactFit: 20, reachability: 10 };
    await upsertLead(db, user, {
      runId,
      companyId: a.company.id,
      contactId: contact.contact.id,
      score,
    });
    await upsertLead(db, user, { runId, companyId: a.company.id, contactId: null, score });
    await upsertLead(db, user, { runId: run2, companyId: b.company.id, contactId: null, score });

    // A second run finding the same company, contact and lead keeps the first run's ID.
    expect(
      (
        await upsertCompany(
          db,
          user,
          { name: fact('Alpha'), governorate: fact('sfax'), regionCellId: cellB!.id },
          run2,
        )
      ).company,
    ).toMatchObject({ runId, regionCellId: cellA!.id });
    expect(
      (
        await upsertContact(
          db,
          user,
          { companyId: a.company.id, fullName: fact('Amine'), linkedinPublicId: fact('amine') },
          run2,
        )
      ).contact.runId,
    ).toBe(runId);
    expect(
      (await upsertLead(db, user, {
        runId: run2,
        companyId: a.company.id,
        contactId: null,
        score,
      }))!.lead.runId,
    ).toBe(runId);

    await recordCost(db, user, apify(1000, { regionCellId: cellA!.id })); // $4, run 1, cell A
    await recordCost(db, user, apify(500, { runId: run2, regionCellId: cellB!.id })); // $2, run 2, cell B
    await recordCost(db, user, { ...apify(1), provider: 'llm', item: 'model-x', unitPriceUsd: 1 }); // $1, run 1, no cell

    expect(await costPerLeadForRun(db, user, runId)).toEqual({
      spentUsd: 5,
      leads: 2,
      costPerLeadUsd: 2.5,
    });
    expect(await costPerLeadForRun(db, user, run2)).toEqual({
      spentUsd: 2,
      leads: 1,
      costPerLeadUsd: 2,
    });
    expect(await costPerLeadForRegion(db, user, 'sfax')).toEqual({
      spentUsd: 7,
      leads: 3,
      costPerLeadUsd: 7 / 3,
    });
    expect(await costPerLeadForCell(db, user, cellA!.id)).toEqual({
      spentUsd: 4,
      leads: 2,
      costPerLeadUsd: 2,
    });
    expect(await costPerLeadForRegion(db, user, 'tunis')).toEqual({
      spentUsd: 0,
      leads: 0,
      costPerLeadUsd: null,
    });
  });
});
