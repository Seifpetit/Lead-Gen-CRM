import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getCompany,
  listCompanies,
  listCompaniesDueForRefresh,
  upsertCompany,
  type CompanyInput,
} from './companies.js';
import type { Db } from './db.js';
import { listEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import { EvidenceError, type Sourced } from './sourced.js';
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

const at = new Date('2026-10-01T10:00:00Z');
const fact = <T>(value: T): Sourced<T> => ({
  value,
  sourceUrl: 'https://maps.google.com/?cid=1',
  fetchedAt: at,
  kind: 'fact',
});
const company = (
  extra: Omit<Partial<CompanyInput>, 'name'> & { name?: string } = {},
): CompanyInput => {
  const { name = 'Transports Ben Salah', ...rest } = extra;
  return { name: fact(name), governorate: fact('sfax'), ...rest };
};

describe('upsertCompany dedupe', () => {
  it('matches on Google place ID first, even when the name differs', async () => {
    const a = await upsertCompany(db, user, company({ googlePlaceId: fact('place-1') }));
    const b = await upsertCompany(
      db,
      user,
      company({ name: 'TBS Logistique', googlePlaceId: fact('place-1') }),
    );
    expect(b).toMatchObject({ created: false, matchedBy: 'google_place_id' });
    expect(b.company.id).toBe(a.company.id);
    expect(b.company.name).toBe('TBS Logistique');
  });

  it('matches on a normalized phone before the website or the name', async () => {
    const a = await upsertCompany(
      db,
      user,
      company({ phone: fact('74 123 456'), website: fact('https://one.tn') }),
    );
    // Different name, different website, same number written another way.
    const b = await upsertCompany(
      db,
      user,
      company({
        name: 'Entirely Different Name',
        phone: fact('+216 74-123-456'),
        website: fact('https://two.tn'),
      }),
    );
    expect(b).toMatchObject({ created: false, matchedBy: 'phone' });
    expect(b.company.id).toBe(a.company.id);
    expect(b.company.phoneE164).toBe('+21674123456');
  });

  it('stores the E.164 form and flags a number from another country', async () => {
    const tn = await upsertCompany(db, user, company({ phone: fact('98 123 456') }));
    expect(tn.company).toMatchObject({ phoneE164: '+21698123456', phoneForeign: false });
    const fr = await upsertCompany(
      db,
      user,
      company({ name: 'Maison Mère', phone: fact('+33 1 23 45 67 89') }),
    );
    expect(fr.company).toMatchObject({ phoneE164: '+33123456789', phoneForeign: true });
    const none = await upsertCompany(db, user, company({ name: 'No Phone Co' }));
    expect(none.company).toMatchObject({ phoneE164: null, phoneForeign: false });
  });

  it('matches on normalized domain next', async () => {
    const a = await upsertCompany(db, user, company({ website: fact('https://www.tbs.tn/') }));
    const b = await upsertCompany(
      db,
      user,
      company({ name: 'Other Name', website: fact('http://TBS.tn/contact') }),
    );
    expect(b).toMatchObject({ created: false, matchedBy: 'domain' });
    expect(b.company.id).toBe(a.company.id);
  });

  it('matches on name plus governorate ignoring accents and SARL, SA, Ste', async () => {
    const a = await upsertCompany(
      db,
      user,
      company({ name: 'Sté Société Générale des Huiles SARL' }),
    );
    for (const name of [
      'STE GENERALE DES HUILES',
      'Générale des Huiles S.A.',
      'generale  des huiles sa',
    ]) {
      const b = await upsertCompany(db, user, company({ name }));
      expect(b).toMatchObject({ created: false, matchedBy: 'name_governorate' });
      expect(b.company.id).toBe(a.company.id);
    }
  });

  it('does not match the same name in another governorate', async () => {
    await upsertCompany(db, user, company());
    const b = await upsertCompany(db, user, { ...company(), governorate: fact('sousse') });
    expect(b.created).toBe(true);
  });

  it('keeps same-name companies apart when their place IDs differ (branches)', async () => {
    await upsertCompany(db, user, company({ googlePlaceId: fact('place-1') }));
    const b = await upsertCompany(db, user, company({ googlePlaceId: fact('place-2') }));
    expect(b.created).toBe(true);
    expect(await listCompanies(db, user)).toHaveLength(2);
  });

  it('treats a Facebook page as no domain, so two companies on Facebook stay apart', async () => {
    await upsertCompany(
      db,
      user,
      company({ name: 'Alpha', website: fact('https://facebook.com/alpha') }),
    );
    const b = await upsertCompany(
      db,
      user,
      company({ name: 'Beta', website: fact('https://facebook.com/beta') }),
    );
    expect(b.created).toBe(true);
    expect(b.company.domain).toBeNull();
  });

  it('does not steal a domain already owned by another company', async () => {
    const alpha = await upsertCompany(
      db,
      user,
      company({ name: 'Alpha', website: fact('alpha.tn') }),
    );
    const beta = await upsertCompany(
      db,
      user,
      company({ name: 'Beta', googlePlaceId: fact('place-b') }),
    );
    // Beta's listing now links to Alpha's site: Beta matches by place ID but keeps no domain.
    const again = await upsertCompany(
      db,
      user,
      company({ name: 'Beta', googlePlaceId: fact('place-b'), website: fact('alpha.tn') }),
    );
    expect(again).toMatchObject({
      matchedBy: 'google_place_id',
      company: { id: beta.company.id, domain: null },
    });
    expect((await getCompany(db, user, alpha.company.id))?.domain).toBe('alpha.tn');
  });

  it('dedupes per user: the same place for two users is two rows', async () => {
    const other = await makeUser(db);
    const a = await upsertCompany(db, user, company({ googlePlaceId: fact('place-1') }));
    const b = await upsertCompany(db, other, company({ googlePlaceId: fact('place-1') }));
    expect(b.created).toBe(true);
    expect(b.company.id).not.toBe(a.company.id);
  });
});

describe('upsertCompany evidence', () => {
  it('records source, time and kind for every value written', async () => {
    const { company: c } = await upsertCompany(
      db,
      user,
      company({
        phone: fact('+216 74 000 001'),
        sector: {
          value: 'agri-food',
          sourceUrl: 'https://example.tn',
          fetchedAt: at,
          kind: 'estimate',
        },
      }),
    );
    const ev = await listEvidence(db, user, { companyId: c.id });
    expect(ev.map((e) => e.field).sort()).toEqual(['governorate', 'name', 'phone', 'sector']);
    expect(ev.find((e) => e.field === 'sector')).toMatchObject({
      kind: 'estimate',
      sourceUrl: 'https://example.tn',
    });
    expect(ev.every((e) => e.fetchedAt === at.toISOString())).toBe(true);
  });

  it('rejects a value without a valid source and writes nothing', async () => {
    const bad = company({ phone: { ...fact('+216 74 000 001'), sourceUrl: 'not a url' } });
    await expect(upsertCompany(db, user, bad)).rejects.toThrow(EvidenceError);
    expect(await listCompanies(db, user)).toHaveLength(0);
  });

  it('another user cannot read the company or its evidence', async () => {
    const { company: c } = await upsertCompany(db, user, company());
    const other = await makeUser(db);
    expect(await getCompany(db, other, c.id)).toBeNull();
    expect(await listEvidence(db, other, { companyId: c.id })).toEqual([]);
  });
});

describe('provider refresh', () => {
  it('stores source provider and refresh date without making them evidence', async () => {
    const refreshBy = new Date('2026-10-31T00:00:00Z');
    const { company: c } = await upsertCompany(
      db,
      user,
      company({ googlePlaceId: fact('place-1'), sourceProvider: 'google_maps', refreshBy }),
    );
    expect(c).toMatchObject({ sourceProvider: 'google_maps', refreshBy });
    const ev = await listEvidence(db, user, { companyId: c.id });
    expect(ev.map((e) => e.field)).not.toContain('refreshBy');

    expect(await listCompaniesDueForRefresh(db, user, new Date('2026-10-30T00:00:00Z'))).toEqual(
      [],
    );
    expect((await listCompaniesDueForRefresh(db, user, refreshBy)).map((x) => x.id)).toEqual([
      c.id,
    ]);

    // A refresh moves the date forward; companies without one never come due.
    const later = new Date('2026-11-30T00:00:00Z');
    await upsertCompany(db, user, company({ googlePlaceId: fact('place-1'), refreshBy: later }));
    await upsertCompany(db, user, company({ name: 'Other' }));
    expect(await listCompaniesDueForRefresh(db, user, refreshBy)).toEqual([]);
    expect(await listCompaniesDueForRefresh(db, await makeUser(db), later)).toEqual([]);
  });
});
