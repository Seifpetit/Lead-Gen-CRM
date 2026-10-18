import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, LOG_REDACT } from '../app.js';
import { upsertCompany } from '../data/companies.js';
import { upsertLead } from '../data/crmLeads.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRun } from '../data/runs.js';
import { openTestDb, resetData } from '../data/testDb.js';
import { testRunner } from '../test/testRunner.js';
import { SESSION_COOKIE } from './plugin.js';
import { AuthService, DEFAULT_POLICY, type AuthPolicy } from './service.js';

const PASSWORD = 'correct horse battery';
const START = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;

let db: Db;
let app: FastifyInstance;
let auth: AuthService;
let now: Date;
let logs: string[];

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

async function start(policy: Partial<AuthPolicy> = {}): Promise<void> {
  logs = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  auth = new AuthService(db, { ...DEFAULT_POLICY, ...policy }, () => now);
  app = await buildApp({
    db,
    auth,
    runner: testRunner(db).runner,
    logger: { level: 'trace', redact: LOG_REDACT, stream },
  });
}

beforeEach(async () => {
  await resetData(db);
  now = START;
  await start();
});
afterEach(async () => {
  await app.close();
});

async function login(email: string, password = PASSWORD, ip = '10.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
    remoteAddress: ip,
  });
}

function sessionToken(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c?.value) throw new Error('no session cookie');
  return c.value;
}

async function signedIn(email: string): Promise<{ id: UserId; token: string }> {
  const id = await auth.createUserAsAdmin(email, PASSWORD);
  const res = await login(email);
  expect(res.statusCode).toBe(204);
  return { id, token: sessionToken(res) };
}

const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, ...(token ? { cookies: { [SESSION_COOKIE]: token } } : {}) });

describe('login', () => {
  it('sets an httpOnly, secure, same-site session cookie', async () => {
    await auth.createUserAsAdmin('a@example.com', PASSWORD);
    const res = await login('A@Example.com');
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect((await get('/api/auth/me', cookie.value)).json()).toMatchObject({
      email: 'a@example.com',
    });
  });

  it('rejects a wrong password and an unknown email with the same response', async () => {
    await auth.createUserAsAdmin('a@example.com', PASSWORD);
    const wrong = await login('a@example.com', 'wrong password!!');
    const unknown = await login('nobody@example.com');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_credentials' });
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    }
  });

  it('locks an email after 5 failures, even for the right password, then unlocks', async () => {
    await auth.createUserAsAdmin('a@example.com', PASSWORD);
    for (let i = 0; i < 5; i++)
      expect((await login('a@example.com', 'nope nope nope')).statusCode).toBe(401);
    const locked = await login('a@example.com');
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    // Other accounts are unaffected.
    await auth.createUserAsAdmin('b@example.com', PASSWORD);
    expect((await login('b@example.com', PASSWORD, '10.0.0.2')).statusCode).toBe(204);

    now = new Date(START.getTime() + 16 * MIN);
    expect((await login('a@example.com')).statusCode).toBe(204);
  });

  it('throttles an IP after 20 failures across different emails', async () => {
    for (let i = 0; i < 20; i++) await login(`user${i}@example.com`, 'nope nope nope', '10.9.9.9');
    await auth.createUserAsAdmin('real@example.com', PASSWORD);
    expect((await login('real@example.com', PASSWORD, '10.9.9.9')).statusCode).toBe(429);
    expect((await login('real@example.com', PASSWORD, '10.0.0.3')).statusCode).toBe(204);
  });
});

describe('sessions', () => {
  it('rejects requests without a session with 401, including unknown routes', async () => {
    expect((await get('/api/auth/me')).statusCode).toBe(401);
    expect((await get('/api/auth/me', 'forged-token')).statusCode).toBe(401);
    expect((await get('/api/does-not-exist')).statusCode).toBe(401);
  });

  it('expires after the idle timeout', async () => {
    const { token } = await signedIn('a@example.com');
    now = new Date(START.getTime() + 11 * 60 * MIN);
    expect((await get('/api/auth/me', token)).statusCode).toBe(200);
    // Activity at 11h slid the idle window; 12h of silence after that ends it.
    now = new Date(now.getTime() + 12 * 60 * MIN + 1);
    expect((await get('/api/auth/me', token)).statusCode).toBe(401);
  });

  it('expires at the absolute limit even when active', async () => {
    const { token } = await signedIn('a@example.com');
    for (let h = 10; h < 7 * 24; h += 10) {
      now = new Date(START.getTime() + h * 60 * MIN);
      expect((await get('/api/auth/me', token)).statusCode).toBe(200);
    }
    now = new Date(START.getTime() + 7 * 24 * 60 * MIN + 1);
    expect((await get('/api/auth/me', token)).statusCode).toBe(401);
  });

  it('logout invalidates the session server-side', async () => {
    const { token } = await signedIn('a@example.com');
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
    // Replaying the old cookie no longer works.
    expect((await get('/api/auth/me', token)).statusCode).toBe(401);
  });
});

describe('cross-user access fails closed', () => {
  it("returns 404 for another user's run and lead, same as a random ID", async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const run = await createRun(db, alice.id, { regionId: 'sfax', budgetCapUsd: 10 });
    const src = { sourceUrl: 'https://example.tn', fetchedAt: START, kind: 'fact' as const };
    const { company } = await upsertCompany(db, alice.id, {
      name: { value: 'Alpha', ...src },
      governorate: { value: 'sfax', ...src },
    });
    const { lead } = (await upsertLead(db, alice.id, {
      runId: run.id,
      companyId: company.id,
      contactId: null,
      score: { companyFit: 10, contactFit: 0, reachability: 5 },
    }))!;

    expect((await get(`/api/runs/${run.id}`, alice.token)).json()).toMatchObject({ id: run.id });
    expect((await get(`/api/leads/${lead.id}`, alice.token)).json()).toMatchObject({ id: lead.id });

    for (const url of [`/api/runs/${run.id}`, `/api/leads/${lead.id}`]) {
      expect((await get(url, bob.token)).statusCode).toBe(404);
      expect((await get(url)).statusCode).toBe(401);
    }
    expect(
      (await get('/api/runs/00000000-0000-4000-8000-000000000000', bob.token)).statusCode,
    ).toBe(404);
    expect((await get("/api/runs/1' OR '1'='1", bob.token)).statusCode).toBe(404);
  });
});

describe('sign-up', () => {
  const signup = (payload: object) =>
    app.inject({ method: 'POST', url: '/api/auth/signup', payload });

  it('is invite-only by default', async () => {
    expect((await signup({ email: 'n@example.com', password: PASSWORD })).statusCode).toBe(403);
    expect(
      (await signup({ email: 'n@example.com', password: PASSWORD, inviteCode: 'made-up' }))
        .statusCode,
    ).toBe(403);

    const { code } = await auth.createInvite();
    const ok = await signup({ email: 'n@example.com', password: PASSWORD, inviteCode: code });
    expect(ok.statusCode).toBe(201);
    expect((await get('/api/auth/me', sessionToken(ok))).statusCode).toBe(200);
    // One-time: a second use fails.
    expect(
      (await signup({ email: 'm@example.com', password: PASSWORD, inviteCode: code })).statusCode,
    ).toBe(403);
  });

  it('rejects an expired invite and a short password', async () => {
    const { code } = await auth.createInvite();
    expect(
      (await signup({ email: 'n@example.com', password: 'short', inviteCode: code })).statusCode,
    ).toBe(400);
    now = new Date(START.getTime() + 8 * 24 * 60 * MIN);
    expect(
      (await signup({ email: 'n@example.com', password: PASSWORD, inviteCode: code })).statusCode,
    ).toBe(403);
  });

  it('allows sign-up without a code when the flag is open', async () => {
    await app.close();
    await start({ signupMode: 'open' });
    expect((await signup({ email: 'n@example.com', password: PASSWORD })).statusCode).toBe(201);
    expect((await signup({ email: 'N@example.com', password: PASSWORD })).statusCode).toBe(409);
  });
});

describe('logging', () => {
  it('never logs passwords, session tokens or invite codes', async () => {
    const { code } = await auth.createInvite();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'n@example.com', password: PASSWORD, inviteCode: code },
    });
    const token = sessionToken(res);
    await get('/api/auth/me', token);
    await login('n@example.com', 'a wrong password');
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });

    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD, 'a wrong password', token, code])
      expect(all).not.toContain(secret);
  });
});
