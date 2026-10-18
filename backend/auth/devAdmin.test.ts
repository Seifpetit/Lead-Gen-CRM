import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, LOG_REDACT } from '../app.js';
import type { Db } from '../data/db.js';
import { findUserByEmail } from '../data/users.js';
import { openTestDb, resetData } from '../data/testDb.js';
import { testRunner } from '../test/testRunner.js';
import { SESSION_COOKIE } from './plugin.js';
import { AuthService, DEFAULT_POLICY } from './service.js';

let db: Db;
let app: FastifyInstance;
let auth: AuthService;

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
});
afterEach(async () => {
  await app.close();
});

async function start(devAdminLogin: boolean): Promise<void> {
  auth = new AuthService(db, { ...DEFAULT_POLICY, signupMode: 'open', devAdminLogin });
  app = await buildApp({
    db,
    auth,
    runner: testRunner(db).runner,
    logger: { level: 'silent', redact: LOG_REDACT },
  });
}

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const token = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;

describe('dev admin login off (default)', () => {
  beforeEach(() => start(false));

  it('rejects test/test on sign-in, sign-up and the admin path, and creates nothing', async () => {
    expect((await post('/api/auth/login', { email: 'test', password: 'test' })).statusCode).toBe(
      400,
    );
    expect((await post('/api/auth/signup', { email: 'test', password: 'test' })).statusCode).toBe(
      400,
    );
    await expect(auth.createUserAsAdmin('test', 'test')).rejects.toThrow(/at least 12/);
    expect(await findUserByEmail(db, 'test')).toBeNull();
    const config = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(config.json()).toMatchObject({ devAdminLogin: false });
  });

  it('refuses a leftover test account once the flag is off', async () => {
    await app.close();
    await start(true);
    await auth.createUserAsAdmin('test', 'test');
    await app.close();
    await start(false);
    expect((await post('/api/auth/login', { email: 'test', password: 'test' })).statusCode).toBe(
      400,
    );
  });
});

describe('dev admin login on', () => {
  beforeEach(() => start(true));

  it('signs test/test up, out and back in, with a normal session', async () => {
    const signup = await post('/api/auth/signup', { email: 'test', password: 'test' });
    expect(signup.statusCode).toBe(201);
    const stored = await findUserByEmail(db, 'test');
    expect(stored?.passwordHash).toMatch(/^\$argon2/);

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token(signup)! },
    });
    expect(out.statusCode).toBe(204);

    const login = await post('/api/auth/login', { email: 'test', password: 'test' });
    expect(login.statusCode).toBe(204);
    expect(login.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: token(login)! },
    });
    expect(me.json()).toMatchObject({ email: 'test' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json()).toMatchObject({
      devAdminLogin: true,
    });
  });

  it('still rejects every other weak password or non-email login', async () => {
    for (const payload of [
      { email: 'test', password: 'test1' },
      { email: 'test', password: 'Test' },
      { email: 'tester', password: 'test' },
      { email: 'other@example.com', password: 'test' },
      { email: 'not-an-email', password: 'long-enough-password' },
    ]) {
      expect((await post('/api/auth/signup', payload)).statusCode).toBe(400);
    }
    // Sign-in has no length rule; a non-email login other than "test" is malformed.
    expect((await post('/api/auth/login', { email: 'tester', password: 'test' })).statusCode).toBe(
      400,
    );
    expect((await post('/api/auth/login', { email: 'test', password: 'Test' })).statusCode).toBe(
      401,
    );
    await expect(auth.createUserAsAdmin('other@example.com', 'test')).rejects.toThrow();
  });

  it('applies the normal lockout to the test login', async () => {
    await auth.createUserAsAdmin('test', 'test');
    for (let i = 0; i < DEFAULT_POLICY.maxFailuresPerEmail; i++) {
      expect(
        (await post('/api/auth/login', { email: 'test', password: 'test-wrong' })).statusCode,
      ).toBe(401);
    }
    expect((await post('/api/auth/login', { email: 'test', password: 'test' })).statusCode).toBe(
      429,
    );
  });

  it('removes the user and its sessions with the disable command', async () => {
    const signup = await post('/api/auth/signup', { email: 'test', password: 'test' });
    expect(await auth.removeDevAdminUser()).toBe(true);
    expect(await findUserByEmail(db, 'test')).toBeNull();
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: token(signup)! },
    });
    expect(me.statusCode).toBe(401);
    expect(await auth.removeDevAdminUser()).toBe(false);
  });
});
