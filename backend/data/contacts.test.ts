import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from './companies.js';
import {
  getContact,
  listContactsForCompany,
  upsertContact,
  UnknownCompanyError,
} from './contacts.js';
import type { Db } from './db.js';
import { listEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import type { Sourced } from './sourced.js';
import { addSuppression, SuppressedContactError } from './suppressionList.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let user: UserId;
let companyId: string;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://www.linkedin.com/in/x',
  fetchedAt: new Date('2026-10-01T10:00:00Z'),
  kind: 'fact',
});

beforeEach(async () => {
  await resetData(db);
  user = await makeUser(db);
  companyId = (await upsertCompany(db, user, { name: fact('Alpha'), governorate: fact('sfax') }))
    .company.id;
});

describe('upsertContact', () => {
  it('dedupes on LinkedIn public ID, case- and encoding-insensitive', async () => {
    const a = await upsertContact(db, user, {
      companyId,
      fullName: fact('Amine B.'),
      linkedinPublicId: fact('amine-b-123'),
    });
    const b = await upsertContact(db, user, {
      companyId,
      fullName: fact('Amine Ben Ali'),
      title: fact('Responsable Logistique'),
      linkedinPublicId: fact('Amine-B-123'),
    });
    expect(b.created).toBe(false);
    expect(b.contact.id).toBe(a.contact.id);
    expect(b.contact).toMatchObject({ fullName: 'Amine Ben Ali', title: 'Responsable Logistique' });
    expect(await listContactsForCompany(db, user, companyId)).toHaveLength(1);
  });

  it('records evidence for each field, including booleans', async () => {
    const { contact } = await upsertContact(db, user, {
      companyId,
      fullName: fact('Amine'),
      currentRoleVerified: fact(true),
    });
    const ev = await listEvidence(db, user, { contactId: contact.id });
    expect(ev.map((e) => [e.field, e.value]).sort()).toEqual([
      ['currentRoleVerified', 'true'],
      ['fullName', 'Amine'],
    ]);
    expect(contact.currentRoleVerified).toBe(true);
  });

  it.each([
    ['email', 'Amine@Alpha.tn', { email: fact('amine@alpha.tn') }],
    ['phone', '+216 98 123 456', { phone: fact('98123456') }],
    ['linkedin', 'amine-b-123', { linkedinPublicId: fact('AMINE-B-123') }],
  ] as const)(
    'refuses to store a contact whose %s is suppressed',
    async (kind, suppressed, fields) => {
      await addSuppression(db, user, {
        kind,
        value: suppressed,
        reason: 'asked not to be contacted',
      });
      await expect(
        upsertContact(db, user, { companyId, fullName: fact('Amine'), ...fields }),
      ).rejects.toThrow(SuppressedContactError);
      expect(await listContactsForCompany(db, user, companyId)).toHaveLength(0);
    },
  );

  it('applies suppression recorded by another user', async () => {
    const other = await makeUser(db);
    await addSuppression(db, other, {
      kind: 'email',
      value: 'amine@alpha.tn',
      reason: 'objection',
    });
    await expect(
      upsertContact(db, user, {
        companyId,
        fullName: fact('Amine'),
        email: fact('amine@alpha.tn'),
      }),
    ).rejects.toThrow(SuppressedContactError);
  });

  it('refuses an update to a contact whose stored email became suppressed', async () => {
    await upsertContact(db, user, {
      companyId,
      fullName: fact('Amine'),
      linkedinPublicId: fact('a1'),
      email: fact('a@alpha.tn'),
    });
    await addSuppression(db, user, { kind: 'email', value: 'a@alpha.tn', reason: 'objection' });
    await expect(
      upsertContact(db, user, { companyId, fullName: fact('Amine'), linkedinPublicId: fact('a1') }),
    ).rejects.toThrow(SuppressedContactError);
  });

  it("cannot attach a contact to another user's company, or read another user's contact", async () => {
    const other = await makeUser(db);
    await expect(upsertContact(db, other, { companyId, fullName: fact('X') })).rejects.toThrow(
      UnknownCompanyError,
    );
    const { contact } = await upsertContact(db, user, { companyId, fullName: fact('Amine') });
    expect(await getContact(db, other, contact.id)).toBeNull();
  });
});
