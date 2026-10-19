import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from './companies.js';
import { upsertContact } from './contacts.js';
import {
  addDecisionMaker,
  BoardError,
  getCard,
  isCompanyRemoved,
  isPersonRemoved,
  loadBoard,
  moveCard,
  purgeNoise,
  removeCard,
  restoreCard,
} from './crmBoards.js';
import { listLeads, upsertLead } from './crmLeads.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { createRun } from './runs.js';
import type { Sourced } from './sourced.js';
import { addSuppression, findSuppressed } from './suppressionList.js';
import { makeUser, openTestDb, resetData } from './testDb.js';
import { dismissalFeedback } from './views.js';

let db: Db;
let user: UserId;
let runId: string;
let companyId: string;
let contactId: string;
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
const DAY = 86_400_000;
const RETENTION = 30;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

async function companyCard(id = companyId) {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM crm_cards WHERE user_id = $1 AND pipeline = 'companies' AND company_id = $2`,
    [user, id],
  );
  return rows[0]?.id as string;
}
async function stageOf(cardId: string) {
  return (await getCard(db, user, cardId, RETENTION))?.stage;
}
const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof BoardError ? e.code : 'other'),
  );

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 10 })).id;
  companyId = (
    await upsertCompany(db, user, {
      name: fact('Alpha Huiles'),
      governorate: fact('sfax'),
      googlePlaceId: fact('place-alpha'),
      sector: fact('food'),
      phone: fact('74 111 222'),
    })
  ).company.id;
  contactId = (
    await upsertContact(db, user, {
      companyId,
      fullName: fact('Amine'),
      roleClass: fact('logistics'),
      linkedinPublicId: fact('amine-b'),
      email: fact('amine@alpha.tn'),
    })
  ).contact.id;
  await upsertLead(db, user, { runId, companyId, contactId, score });
});

describe('the Companies board', () => {
  it('has a card in Found for every company with a lead, and keeps it where the user put it', async () => {
    const card = await companyCard();
    expect(await stageOf(card)).toBe('found');
    await moveCard(db, user, card, 'investigating');
    // The pipeline finding the company again does not pull the card back.
    await upsertLead(db, user, { runId, companyId, contactId: null, score });
    expect(await stageOf(card)).toBe('investigating');
    const board = await loadBoard(db, user, 'companies', RETENTION);
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({
      company: { name: 'Alpha Huiles' },
      score: 75,
      person: null,
    });
  });

  it('refuses Decision-maker identified until a decision-maker is added', async () => {
    const card = await companyCard();
    expect(await code(moveCard(db, user, card, 'decision_maker_identified'))).toBe(
      'decision_maker_required',
    );
    expect(await stageOf(card)).toBe('found');
    expect(await code(moveCard(db, user, card, 'new'))).toBe('invalid_stage');
  });

  it('adds a decision-maker: person card in New, linked to the company, company moves on', async () => {
    const card = await companyCard();
    const { company, person } = await addDecisionMaker(
      db,
      user,
      card,
      {
        fullName: ' Sami Trabelsi ',
        title: 'Directeur logistique',
        roleClass: 'logistics',
        phone: '98 000 111',
      },
      RETENTION,
    );
    expect(company).toMatchObject({ id: card, stage: 'decision_maker_identified' });
    expect(person).toMatchObject({
      pipeline: 'people',
      stage: 'new',
      company: { id: companyId },
      person: { fullName: 'Sami Trabelsi', title: 'Directeur logistique', phone: '98 000 111' },
    });
    const { rows } = await db.query('SELECT company_id FROM contacts WHERE id = $1', [
      person.person!.id,
    ]);
    expect(rows[0]).toMatchObject({ company_id: companyId });
    // The same person again does not make a second card.
    await addDecisionMaker(db, user, card, { fullName: 'Sami', phone: '98 000 111' }, RETENTION);
    const people = await loadBoard(db, user, 'people', RETENTION);
    expect(people.cards.filter((c) => c.person?.fullName.startsWith('Sami'))).toHaveLength(1);
  });

  it('needs a name and one channel, and stores nothing when it refuses', async () => {
    const card = await companyCard();
    for (const bad of [
      { fullName: 'Sami' },
      { fullName: 'Sami', email: '  ', phone: '' },
      { fullName: ' ', email: 'a@b.tn' },
    ]) {
      expect(await code(addDecisionMaker(db, user, card, bad, RETENTION))).toBe(
        'invalid_decision_maker',
      );
    }
    await addSuppression(db, user, { kind: 'email', value: 'no@thanks.tn', reason: 'objected' });
    expect(
      await code(
        addDecisionMaker(db, user, card, { fullName: 'Nour', email: 'NO@thanks.tn' }, RETENTION),
      ),
    ).toBe('suppressed');
    expect(await stageOf(card)).toBe('found');
    expect((await loadBoard(db, user, 'people', RETENTION)).cards).toEqual([]);
    const { rows } = await db.query("SELECT 1 FROM contacts WHERE full_name = 'Nour'");
    expect(rows).toEqual([]);
  });

  it('lets a company with a live decision-maker go back into the last column without the form', async () => {
    const card = await companyCard();
    const { person } = await addDecisionMaker(
      db,
      user,
      card,
      { fullName: 'Sami', email: 's@a.tn' },
      RETENTION,
    );
    await moveCard(db, user, card, 'investigating');
    await moveCard(db, user, card, 'decision_maker_identified');
    expect(await stageOf(card)).toBe('decision_maker_identified');
    await removeCard(db, user, person.id);
    await moveCard(db, user, card, 'found');
    expect(await code(moveCard(db, user, card, 'decision_maker_identified'))).toBe(
      'decision_maker_required',
    );
  });
});

describe('the People board', () => {
  async function person(email = 'sami@alpha.tn') {
    const { person } = await addDecisionMaker(
      db,
      user,
      await companyCard(),
      { fullName: 'Sami', email },
      RETENTION,
    );
    return person;
  }

  it('moves freely between its columns', async () => {
    const p = await person();
    for (const stage of ['contacted', 'replied', 'won', 'lost', 'new'] as const) {
      await moveCard(db, user, p.id, stage);
      expect(await stageOf(p.id)).toBe(stage);
    }
  });

  it('records an objection when moved to Opted out, and it is final', async () => {
    const p = await person();
    expect(await code(moveCard(db, user, p.id, 'opted_out'))).toBe('reason_required');
    await moveCard(db, user, p.id, 'opted_out', { reason: 'asked to stop' });
    expect(await findSuppressed(db, { email: 'sami@alpha.tn' })).toEqual(['email']);
    expect(await code(moveCard(db, user, p.id, 'contacted'))).toBe('opted_out_is_final');
    expect(await code(removeCard(db, user, p.id))).toBe('opted_out_is_final');
    expect(await stageOf(p.id)).toBe('opted_out');
  });
});

describe('remove and restore', () => {
  it('removing a company card sends it to Noise and dismisses its leads for scoring', async () => {
    const card = await companyCard();
    await moveCard(db, user, card, 'investigating');
    await removeCard(db, user, card);
    const c = (await getCard(db, user, card, RETENTION))!;
    expect(c).toMatchObject({ stage: 'noise', removedFrom: 'investigating' });
    expect(Date.parse(c.purgeAt!) - Date.parse(c.noiseAt!)).toBe(RETENTION * DAY);
    expect(await listLeads(db, user, { stage: 'dismissed' })).toHaveLength(1);
    expect(await dismissalFeedback(db, user)).toEqual({
      bySector: { food: 1 },
      byRoleClass: { logistics: 1 },
    });
  });

  it('restoring returns the card to where it was and undoes the dismissal', async () => {
    const card = await companyCard();
    await moveCard(db, user, card, 'investigating');
    await removeCard(db, user, card);
    await restoreCard(db, user, card);
    expect(await getCard(db, user, card, RETENTION)).toMatchObject({
      stage: 'investigating',
      noiseAt: null,
      purgeAt: null,
      removedFrom: null,
    });
    expect(await listLeads(db, user, { stage: 'dismissed' })).toEqual([]);
    expect(await dismissalFeedback(db, user)).toEqual({ bySector: {}, byRoleClass: {} });
    expect(await code(restoreCard(db, user, card))).toBe('not_in_noise');
  });

  it('dragging a card into or out of Noise is a removal or a restore', async () => {
    const card = await companyCard();
    await moveCard(db, user, card, 'noise');
    expect(await listLeads(db, user, { stage: 'dismissed' })).toHaveLength(1);
    await moveCard(db, user, card, 'found');
    expect(await stageOf(card)).toBe('found');
    expect(await listLeads(db, user, { stage: 'dismissed' })).toEqual([]);
  });

  it("removing a person dismisses that person's lead and counts their role class", async () => {
    const card = await companyCard();
    const { person } = await addDecisionMaker(
      db,
      user,
      card,
      { fullName: 'Amine', linkedinUrl: 'https://www.linkedin.com/in/Amine-B/' },
      RETENTION,
    );
    // Same LinkedIn ID as the contact the run found: one person, with the run's lead.
    expect(person.person!.id).toBe(contactId);
    await removeCard(db, user, person.id);
    expect(await stageOf(person.id)).toBe('noise');
    expect(await stageOf(card)).toBe('decision_maker_identified');
    expect((await dismissalFeedback(db, user)).byRoleClass).toEqual({ logistics: 1 });
  });

  it('does not restore into the final company column', async () => {
    const card = await companyCard();
    await removeCard(db, user, card);
    expect(await code(restoreCard(db, user, card, 'decision_maker_identified'))).toBe(
      'decision_maker_required',
    );
  });
});

describe('the Noise purge', () => {
  it('deletes a company older than the retention, keeps a marker, and dedupe still skips it', async () => {
    const card = await companyCard();
    await removeCard(db, user, card);
    expect(await purgeNoise(db, RETENTION, inDays(29))).toEqual({ people: 0, companies: 0 });
    expect(await purgeNoise(db, RETENTION, inDays(31))).toEqual({ people: 0, companies: 1 });

    for (const table of ['companies', 'contacts', 'crm_cards', 'crm_leads', 'evidence']) {
      const { rows } = await db.query(`SELECT 1 FROM ${table}`);
      expect(rows, table).toEqual([]);
    }
    const { rows: markers } = await db.query('SELECT * FROM noise_markers');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      kind: 'company',
      google_place_id: 'place-alpha',
      normalized_name: 'alpha huiles',
      phone_key: '21674111222',
      sector: 'food',
    });
    // The same place, or the same name and phone under another place ID, is skipped; others are not.
    const gov = 'sfax';
    expect(
      await isCompanyRemoved(db, user, {
        placeId: 'place-alpha',
        name: 'Whatever',
        governorate: gov,
      }),
    ).toBe(true);
    expect(
      await isCompanyRemoved(db, user, {
        placeId: 'place-new',
        name: 'ALPHA Huiles',
        phone: '+216 74 111 222',
        governorate: gov,
      }),
    ).toBe(true);
    expect(
      await isCompanyRemoved(db, user, {
        placeId: 'place-new',
        name: 'Alpha Huiles',
        governorate: gov,
      }),
    ).toBe(false);
    expect(
      await isCompanyRemoved(db, user, {
        placeId: 'place-other',
        name: 'Beta',
        phone: '74 111 222',
        governorate: gov,
      }),
    ).toBe(false);
    expect(
      await isCompanyRemoved(await db, await makeUser(db), {
        placeId: 'place-alpha',
        name: 'Alpha',
        governorate: gov,
      }),
    ).toBe(false);
    // The scoring feedback outlives the cards.
    expect(await dismissalFeedback(db, user)).toEqual({ bySector: { food: 1 }, byRoleClass: {} });
  });

  it('matches a marker with neither place ID nor phone by name and governorate', async () => {
    const bare = (
      await upsertCompany(db, user, { name: fact('Gamma SARL'), governorate: fact('sfax') })
    ).company.id;
    await upsertLead(db, user, { runId, companyId: bare, contactId: null, score });
    await removeCard(db, user, await companyCard(bare));
    await purgeNoise(db, RETENTION, inDays(31));
    expect(await isCompanyRemoved(db, user, { name: 'gamma sarl', governorate: 'sfax' })).toBe(
      true,
    );
    expect(await isCompanyRemoved(db, user, { name: 'gamma sarl', governorate: 'tunis' })).toBe(
      false,
    );
  });

  it('deletes a removed person with a marker, and keeps the company while it has live cards', async () => {
    const card = await companyCard();
    const { person } = await addDecisionMaker(
      db,
      user,
      card,
      { fullName: 'Sami', email: 'sami@alpha.tn', phone: '98 000 111' },
      RETENTION,
    );
    await removeCard(db, user, person.id);
    await removeCard(db, user, card);
    await moveCard(db, user, card, 'found'); // company back on the board
    expect(await purgeNoise(db, RETENTION, inDays(31))).toEqual({ people: 1, companies: 0 });
    expect(await stageOf(card)).toBe('found');
    expect(await getCard(db, user, person.id, RETENTION)).toBeNull();
    expect(await isPersonRemoved(db, user, { email: 'SAMI@alpha.tn' })).toBe(true);
    expect(await isPersonRemoved(db, user, { phone: '+216 98 000 111' })).toBe(true);
    expect(await isPersonRemoved(db, user, { email: 'other@alpha.tn' })).toBe(false);
  });

  it('keeps a Noise company while a person card is still waiting on it', async () => {
    const card = await companyCard();
    await removeCard(db, user, card);
    await addDecisionMaker(db, user, card, { fullName: 'X', email: 'x@a.tn' }, RETENTION).catch(
      () => null,
    );
    // Another card hangs on the company: it is not purged.
    await db.query(
      `INSERT INTO crm_cards (user_id, pipeline, stage, company_id, contact_id) VALUES ($1, 'people', 'new', $2, $3)`,
      [user, companyId, contactId],
    );
    expect(await purgeNoise(db, RETENTION, inDays(31))).toEqual({ people: 0, companies: 0 });
  });

  it('never purges Opted out, however old, and the table forbids a noise date on it', async () => {
    const card = await companyCard();
    const { person } = await addDecisionMaker(
      db,
      user,
      card,
      { fullName: 'Sami', email: 'sami@alpha.tn' },
      RETENTION,
    );
    await moveCard(db, user, person.id, 'opted_out', { reason: 'asked to stop' });
    await removeCard(db, user, card);
    expect(await purgeNoise(db, RETENTION, inDays(3650))).toEqual({ people: 0, companies: 0 });
    expect(await stageOf(person.id)).toBe('opted_out');
    expect(await stageOf(card)).toBe('noise');
    expect(await findSuppressed(db, { email: 'sami@alpha.tn' })).toEqual(['email']);
    await expect(
      db.query("UPDATE crm_cards SET noise_at = now() - interval '1 year' WHERE id = $1", [
        person.id,
      ]),
    ).rejects.toThrow();
  });

  it('works across users', async () => {
    const other = await makeUser(db);
    const theirs = (
      await upsertCompany(db, other, { name: fact('Theirs'), governorate: fact('sfax') })
    ).company.id;
    const run2 = (await createRun(db, other, { regionId: 'sfax', budgetCapUsd: 10 })).id;
    await upsertLead(db, other, { runId: run2, companyId: theirs, contactId: null, score });
    const theirCard = (
      await db.query<{ id: string }>('SELECT id FROM crm_cards WHERE user_id = $1', [other])
    ).rows[0]!.id;
    expect(await code(removeCard(db, user, theirCard))).toBe('not_found');
    expect(await getCard(db, user, theirCard, RETENTION)).toBeNull();
  });
});
