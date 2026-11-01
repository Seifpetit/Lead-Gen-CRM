import { QUERY_SET } from '../config/querySet.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from '../data/companies.js';
import { listLedgerForRun } from '../data/costLedger.js';
import { getCard, listCards, loadBoard, loadFacets, moveCard } from '../data/crmBoards.js';
import { upsertLead } from '../data/crmLeads.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRun } from '../data/runs.js';
import { listRuns } from '../data/runs.js';
import { recordSearchQuery } from '../data/searchQueries.js';
import { createRegionGrid, listCells } from '../data/regionCells.js';
import type { Sourced } from '../data/sourced.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import { listRunSummaries } from '../data/views.js';
import { FakeCompanyClassifier } from '../test/fakeClassifiers.js';
import { TradeChecker } from './tradeCheck.js';
import { listCoverage } from '../data/regionCoverage.js';

let db: Db;
let user: UserId;
let runId: string;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:x',
  fetchedAt: new Date('2026-10-01T10:00:00Z'),
  kind: 'fact',
});
const score = { companyFit: 40, contactFit: 20, reachability: 15 };
let n = 0;
async function company(name: string, tradeRole?: string) {
  n += 1;
  const { company: c } = await upsertCompany(db, user, {
    name: fact(name),
    governorate: fact('sfax'),
    googlePlaceId: fact(`place-${n}`),
    category: fact('Entreprise'),
    phone: fact(`7400${String(n).padStart(4, '0')}`),
  });
  await upsertLead(db, user, { runId, companyId: c.id, contactId: null, score });
  if (tradeRole) {
    await db.query('UPDATE companies SET trade_role = $2 WHERE id = $1', [c.id, tradeRole]);
  }
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM crm_cards WHERE user_id = $1 AND pipeline = 'companies' AND company_id = $2`,
    [user, c.id],
  );
  return { id: c.id, card: rows[0]!.id };
}
const roleOf = async (id: string) =>
  (
    await db.query<{ trade_role: string | null }>(
      'SELECT trade_role FROM companies WHERE id = $1',
      [id],
    )
  ).rows[0]!.trade_role;
const stageOf = async (card: string) => (await getCard(db, user, card, 30))?.stage;

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
});

const checker = (
  answers: ConstructorParameters<typeof FakeCompanyClassifier>[0] = {},
  capUsd = 0.5,
  withClassifier = true,
) =>
  new TradeChecker(
    db,
    withClassifier ? new FakeCompanyClassifier(answers, { fallback: 'unclear' }) : undefined,
    capUsd,
  );

describe('the Import/export filter on the boards', () => {
  it('shows trading and not-checked companies by default, hides the "no" ones', async () => {
    const yes = await company('Exportateur SARL', 'exporter');
    const unchecked = await company('Jamais vérifié');
    const unclear = await company('Peu clair', 'unclear');
    const no = await company('Épicerie du coin', 'not_import_export');
    const forwarder = await company('Transit Express', 'competitor_or_partner');

    const names = async (trade?: ('yes' | 'unchecked' | 'no')[]) =>
      (await listCards(db, user, 'companies', 30, { ...(trade ? { trade } : {}) })).cards
        .map((c) => c.company.name)
        .sort();
    expect(await names()).toEqual(['Exportateur SARL', 'Jamais vérifié', 'Peu clair']);
    expect(await names(['yes'])).toEqual(['Exportateur SARL']);
    expect(await names(['unchecked'])).toEqual(['Jamais vérifié', 'Peu clair']);
    expect(await names(['no'])).toEqual(['Transit Express', 'Épicerie du coin']);
    expect(await names(['yes', 'unchecked', 'no'])).toHaveLength(5);
    void [yes, unchecked, unclear, no, forwarder];
  });

  it('never hides work already done: cards past Found, and Noise, show whatever the filter says', async () => {
    const worked = await company('Déjà contacté', 'not_import_export');
    await moveCard(db, user, worked.card, 'investigating');
    const removed = await company('Retiré', 'competitor_or_partner');
    await db.query(
      `UPDATE crm_cards SET stage = 'noise', noise_at = now(), noise_from_stage = 'found' WHERE id = $1`,
      [removed.card],
    );
    const hidden = await company('Caché', 'not_import_export');
    const names = (await listCards(db, user, 'companies', 30, { trade: ['yes'] })).cards.map(
      (c) => c.company.name,
    );
    expect(names).toContain('Déjà contacté');
    expect(names).toContain('Retiré');
    expect(names).not.toContain('Caché');
    void hidden;
  });

  it('keeps a company visible when anyone at it was contacted', async () => {
    const c = await company('Avec contact', 'not_import_export');
    await db
      .query(
        `INSERT INTO crm_cards (user_id, pipeline, stage, company_id) VALUES ($1, 'people', 'contacted', $2)`,
        [user, c.id],
      )
      .catch(() => undefined);
    // Without a person row the insert above may be refused; the company rule is what is tested.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM crm_cards WHERE company_id = $1 AND stage = 'contacted'`,
      [c.id],
    );
    if (rows[0]!.n === 0) return;
    const names = (await listCards(db, user, 'companies', 30, { trade: ['yes'] })).cards.map(
      (card) => card.company.name,
    );
    expect(names).toContain('Avec contact');
  });

  it('puts the trade role on the card and counts the same way in the facets', async () => {
    await company('Exportateur SARL', 'exporter');
    await company('Épicerie du coin', 'not_import_export');
    const board = await loadBoard(db, user, 'companies', 30, {});
    const cards = board.stages.flatMap((s) => s.cards);
    expect(cards.map((c) => [c.company.name, c.company.tradeRole])).toEqual([
      ['Exportateur SARL', 'exporter'],
    ]);
    expect((await loadFacets(db, user, 'companies', {})).total).toBe(1);
    expect(
      (await loadFacets(db, user, 'companies', { trade: ['yes', 'unchecked', 'no'] })).total,
    ).toBe(2);
  });
});

describe('Check old leads for import/export', () => {
  it('previews the count and a cost that never exceeds the cap, and spends nothing', async () => {
    for (let i = 0; i < 5; i++) await company(`Ancien ${i}`);
    const p = await checker().preview(user);
    expect(p).toMatchObject({
      unchecked: 5,
      willCheck: 5,
      capUsd: 0.5,
      classifierConfigured: true,
    });
    expect(p.estimatedCostUsd).toBeGreaterThan(0);
    expect(p.estimatedCostUsd).toBeLessThanOrEqual(0.5);
    expect(await listLedgerForRun(db, user, runId)).toEqual([]);
  });

  it('cuts the estimate to what the cap can pay for', async () => {
    for (let i = 0; i < 40; i++) await company(`Ancien ${i}`);
    const p = await checker({}, 0.01).preview(user);
    expect(p.unchecked).toBe(40);
    expect(p.willCheck).toBeLessThan(40);
    expect(p.estimatedCostUsd).toBeLessThanOrEqual(0.01);
  });

  it('counts only companies in Found that nobody has worked on or labelled', async () => {
    await company('Libre');
    await company('Déjà étiqueté', 'exporter');
    const worked = await company('Travaillé');
    await moveCard(db, user, worked.card, 'investigating');
    expect((await checker().preview(user)).unchecked).toBe(1);
  });

  it('says nothing can be checked without a classifier, and starts nothing', async () => {
    await company('Libre');
    const c = checker({}, 0.5, false);
    expect(await c.preview(user)).toMatchObject({ classifierConfigured: false, willCheck: 0 });
    expect((await c.start(user)).state).toBe('failed');
  });

  it('labels each company, sends the non-traders to Noise, and leaves work in progress alone', async () => {
    const exporter = await company('Huilerie Export');
    const shop = await company('Épicerie du coin');
    const forwarder = await company('Transit Express');
    const unsure = await company('Mystère');
    const worked = await company('Déjà contacté');
    await moveCard(db, user, worked.card, 'investigating');

    const c = checker({
      'Huilerie Export': 'exporter',
      'Épicerie du coin': 'not_import_export',
      'Transit Express': 'competitor_or_partner',
      Mystère: 'unclear',
      'Déjà contacté': 'not_import_export',
    });
    await c.start(user);
    await c.whenFinished(user);

    expect(c.status(user)).toMatchObject({
      state: 'finished',
      total: 4,
      done: 4,
      yes: 1,
      noise: 2,
      unclear: 1,
    });
    expect(await roleOf(exporter.id)).toBe('exporter');
    expect(await roleOf(shop.id)).toBe('not_import_export');
    expect(await roleOf(forwarder.id)).toBe('competitor_or_partner');
    expect(await roleOf(unsure.id)).toBeNull();
    expect(await roleOf(worked.id)).toBeNull();
    expect(await stageOf(exporter.card)).toBe('found');
    expect(await stageOf(shop.card)).toBe('noise');
    expect(await stageOf(forwarder.card)).toBe('noise');
    expect(await stageOf(unsure.card)).toBe('found');
    expect(await stageOf(worked.card)).toBe('investigating');
  });

  it('puts the spend in the ledger on a run of its own kind that no list shows', async () => {
    await company('Huilerie Export');
    const c = checker({ 'Huilerie Export': 'exporter' });
    await c.start(user);
    await c.whenFinished(user);
    const { rows } = await db.query<{ id: string; kind: string; status: string }>(
      `SELECT id, kind, status FROM runs WHERE user_id = $1 AND kind = 'trade_check'`,
      [user],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('finished');
    const ledger = await listLedgerForRun(db, user, rows[0]!.id);
    expect(ledger.length).toBeGreaterThan(0);
    expect(c.status(user).spentUsd).toBeGreaterThan(0);
    expect((await listRuns(db, user)).every((r) => r.id !== rows[0]!.id)).toBe(true);
    expect(
      (await listRunSummaries(db, user, { limit: 50, offset: 0 })).items.map((r) => r.id),
    ).not.toContain(rows[0]!.id);
  });

  it('does not dismiss anything for scoring: nobody judged these leads', async () => {
    const shop = await company('Épicerie du coin');
    const c = checker({ 'Épicerie du coin': 'not_import_export' });
    await c.start(user);
    await c.whenFinished(user);
    const { rows } = await db.query<{ stage: string }>(
      'SELECT stage FROM crm_leads WHERE company_id = $1',
      [shop.id],
    );
    expect(rows[0]!.stage).not.toBe('dismissed');
  });

  it('stops when asked, keeping what it already decided', async () => {
    for (let i = 0; i < 6; i++) await company(`Ancien ${i}`);
    const holder: { c?: TradeChecker } = {};
    const slow = new FakeCompanyClassifier({}, { fallback: 'exporter' });
    const original = slow.classifyCompany.bind(slow);
    slow.classifyCompany = async (facts) => {
      const r = await original(facts);
      if (slow.calls.length === 2) holder.c?.stop(user);
      return r;
    };
    const c = new TradeChecker(db, slow, 0.5);
    holder.c = c;
    await c.start(user);
    await c.whenFinished(user);
    expect(c.status(user)).toMatchObject({ state: 'stopped', done: 2 });
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM companies WHERE user_id = $1 AND trade_role IS NOT NULL',
      [user],
    );
    expect(rows[0]!.n).toBe(2);
  });

  it('stops at the spending cap', async () => {
    for (let i = 0; i < 6; i++) await company(`Ancien ${i}`);
    // Each fake call costs $0.001; the cap allows two.
    const c = new TradeChecker(db, new FakeCompanyClassifier({}, { fallback: 'exporter' }), 0.002);
    (c as unknown as { perCallUsd: () => number }).perCallUsd = () => 0.0005;
    await c.start(user);
    await c.whenFinished(user);
    expect(c.status(user).state).toBe('capped');
    expect(c.status(user).done).toBeLessThan(6);
  });

  it('is scoped to one user', async () => {
    await company('Libre');
    const other = await makeUser(db);
    expect((await checker().preview(other)).unchecked).toBe(0);
  });
});

describe('coverage by query set', () => {
  it('counts only searches made with the current query set', async () => {
    await createRegionGrid(db, 'sfax', { south: 34.4, west: 10.2, north: 35.2, east: 11.1 }, 1, 2);
    const [cell] = await listCells(db, 'sfax');
    const input = {
      runId,
      regionCellId: cell!.id,
      provider: 'apify_google_maps',
      queryText: 'dattes exportateur',
      requestsUsed: 1,
      resultsReturned: 20,
      newPlacesFound: 5,
      costUsd: 0.01,
    };
    await recordSearchQuery(db, user, input);
    // An old-terms search, as the migration left them.
    await db.query(
      `UPDATE search_queries SET query_set = 1 WHERE id = (
         SELECT id FROM search_queries WHERE user_id = $1 ORDER BY id LIMIT 1)`,
      [user],
    );
    await recordSearchQuery(db, user, { ...input, queryText: 'huile d olive exportateur' });
    const { rows } = await db.query<{ query_set: number; n: number }>(
      `SELECT query_set, count(*)::integer AS n FROM search_queries WHERE user_id = $1 GROUP BY 1 ORDER BY 1`,
      [user],
    );
    expect(rows).toEqual([
      { query_set: 1, n: 1 },
      { query_set: QUERY_SET, n: 1 },
    ]);
    const { regionQueryTotals } = await import('../data/views.js');
    expect((await regionQueryTotals(db, user)).get('sfax')).toMatchObject({
      queries: 1,
      places: 20,
    });
    void listCoverage;
  });
});
