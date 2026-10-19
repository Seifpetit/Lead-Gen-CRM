import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertCompany } from '../data/companies.js';
import { setMapsImage } from '../data/companyImages.js';
import type { Db } from '../data/db.js';
import { createRun } from '../data/runs.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import { lookupPageImage, runImageLookups } from './imageBackfill.js';

let db: Db;
let server: http.Server;
let site: string;
beforeAll(async () => {
  db = await openTestDb();
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/with-og') {
      return void res.end('<meta property="og:image" content="/logo.png">');
    }
    if (req.url === '/no-image') return void res.end('<title>No image</title>');
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://public.test:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
});
beforeEach(() => resetData(db));

const lookup = ((_h: string, _o: unknown, cb: (e: null, a: object[]) => void) =>
  cb(null, [{ address: '127.0.0.1', family: 4 }])) as never;
const options = { lookup, isBlocked: () => false };
const src = { sourceUrl: 'https://example.tn', fetchedAt: new Date(), kind: 'fact' as const };

/** Each company gets its own host name: the same domain would be the same company. */
const hostFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
async function company(user: string, name: string, path?: string, runId?: string) {
  const website = path ? site.replace('public.test', `${hostFor(name)}.test`) + path : undefined;
  return (
    await upsertCompany(
      db,
      user as never,
      {
        name: { ...src, value: name },
        governorate: { ...src, value: 'sfax' },
        ...(website ? { website: { ...src, value: website } } : {}),
      },
      runId ?? null,
    )
  ).company.id;
}
const imageOf = async (id: string) =>
  (
    await db.query<{ image_url: string | null; image_source: string | null; checked: boolean }>(
      'SELECT image_url, image_source, image_checked_at IS NOT NULL AS checked FROM companies WHERE id = $1',
      [id],
    )
  ).rows[0]!;

describe('the image lookup', () => {
  it('reads og:image from the website and returns nothing for pages without one', async () => {
    expect(await lookupPageImage(`${site}/with-og`, options)).toBe(`${site}/logo.png`);
    expect(await lookupPageImage(`${site}/no-image`, options)).toBeNull();
    expect(await lookupPageImage(`${site}/missing`, options)).toBeNull();
    // Refused addresses are just "no image", never an error or a request.
    expect(await lookupPageImage('http://169.254.169.254/', {})).toBeNull();
    expect(await lookupPageImage('http://localhost:3000/', {})).toBeNull();
  });

  it('prefers the website image over the Maps photo, falls back to Maps, then to nothing', async () => {
    const user = await makeUser(db);
    const runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 5 })).id;
    const both = await company(user, 'Both', '/with-og', runId);
    const mapsOnly = await company(user, 'Maps only', '/no-image', runId);
    const brokenSite = await company(user, 'Broken site', '/missing', runId);
    const noSite = await company(user, 'No site', undefined, runId);
    const nothing = await company(user, 'Nothing', '/no-image', runId);
    for (const id of [both, mapsOnly, brokenSite, noSite]) {
      await setMapsImage(db, user, id, `https://maps.example/${id}.jpg`);
    }

    expect(await runImageLookups(db, 20, options)).toBe(5);
    expect(await imageOf(both)).toMatchObject({
      image_url: `${site.replace('public.test', 'both.test')}/logo.png`,
      image_source: 'og',
    });
    for (const id of [mapsOnly, brokenSite, noSite]) {
      expect(await imageOf(id)).toMatchObject({
        image_url: `https://maps.example/${id}.jpg`,
        image_source: 'maps',
        checked: true,
      });
    }
    expect(await imageOf(nothing)).toMatchObject({
      image_url: null,
      image_source: null,
      checked: true,
    });
    // Done once: nothing is looked up twice.
    expect(await runImageLookups(db, 20, options)).toBe(0);
  });

  it('records each website lookup in the cost ledger at $0, and none for a company with no site', async () => {
    const user = await makeUser(db);
    const runId = (await createRun(db, user, { regionId: 'sfax', budgetCapUsd: 5 })).id;
    await company(user, 'A', '/with-og', runId);
    await company(user, 'B', '/missing', runId);
    await company(user, 'C', undefined, runId);
    await runImageLookups(db, 20, options);
    const { rows } = await db.query<{ provider: string; item: string; amount_usd: string }>(
      'SELECT provider, item, amount_usd FROM cost_ledger WHERE run_id = $1',
      [runId],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ provider: 'web', item: 'company-image-lookup' });
      expect(Number(r.amount_usd)).toBe(0);
    }
    const { rows: run } = await db.query<{ status: string }>(
      'SELECT status FROM runs WHERE id = $1',
      [runId],
    );
    expect(run[0]!.status).toBe('pending');
  });

  it('works through a long queue a batch at a time', async () => {
    const user = await makeUser(db);
    for (let i = 0; i < 5; i++) await company(user, `Co ${i}`);
    expect(await runImageLookups(db, 3, options)).toBe(3);
    expect(await runImageLookups(db, 3, options)).toBe(2);
    expect(await runImageLookups(db, 3, options)).toBe(0);
  });
});
