import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  fingerprintOf,
  getProviderHealth,
  listErrors,
  markProviderFailed,
  markProviderOk,
  recordError,
  stackSummary,
} from './appErrors.js';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let alice: UserId;
let bob: UserId;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  alice = await makeUser(db);
  bob = await makeUser(db);
});

describe('stored errors', () => {
  it('masks secrets in the message and the stack before storing', async () => {
    await recordError(db, {
      userId: alice,
      source: 'provider',
      provider: 'apify',
      kind: 'unknown',
      message: 'failed with token=abcdefgh12345 and key MYSECRETVALUE1 and Bearer zzzzzzzzzz',
      stack:
        'Error: x\n    at run (/home/me/app/backend/runner/x.ts:10:5)\n    at MYSECRETVALUE1 (a.ts:1:1)',
      secrets: ['MYSECRETVALUE1'],
    });
    const [e] = await listErrors(db, alice);
    expect(e!.message).not.toMatch(/abcdefgh12345|MYSECRETVALUE1|zzzzzzzzzz/);
    expect(e!.message).toContain('[hidden]');
    expect(e!.stack).not.toContain('MYSECRETVALUE1');
    expect(e!.stack).not.toContain('/home/me');
  });

  it('counts a repeat once, with its last-seen time, and keeps different failures apart', async () => {
    const base = { userId: alice, source: 'provider', provider: 'apify', step: 'discover' };
    await recordError(db, { ...base, kind: 'timeout', message: 'timed out after 30 s' });
    await recordError(db, { ...base, kind: 'timeout', message: 'timed out after 45 s' });
    await recordError(db, { ...base, kind: 'server_error', message: 'HTTP 500' });
    const errors = await listErrors(db, alice);
    expect(errors).toHaveLength(2);
    const timeout = errors.find((e) => e.kind === 'timeout')!;
    expect(timeout.count).toBe(2);
    expect(Date.parse(timeout.lastSeen)).toBeGreaterThanOrEqual(Date.parse(timeout.firstSeen));
  });

  it('keeps the newest 20 distinct errors, most recent first', async () => {
    for (let i = 0; i < 25; i++) {
      await recordError(db, {
        userId: alice,
        source: 'request',
        kind: `kind_${i}`,
        message: `m ${i}`,
      });
    }
    const errors = await listErrors(db, alice, 20);
    expect(errors).toHaveLength(20);
    expect(errors[0]!.kind).toBe('kind_24');
  });

  it("shows a user their own errors and the ones that belong to no one, never another user's", async () => {
    await recordError(db, { userId: alice, source: 'run', kind: 'a', message: 'alice only' });
    await recordError(db, { userId: bob, source: 'run', kind: 'b', message: 'bob only' });
    await recordError(db, { source: 'webhook', kind: 'invalid_signature', message: 'system' });
    expect((await listErrors(db, alice)).map((e) => e.kind).sort()).toEqual([
      'a',
      'invalid_signature',
    ]);
    expect((await listErrors(db, bob)).map((e) => e.kind).sort()).toEqual([
      'b',
      'invalid_signature',
    ]);
  });

  it('counts repeats of a failure that belongs to no one in one row', async () => {
    for (let i = 0; i < 3; i++) {
      await recordError(db, { source: 'webhook', kind: 'invalid_signature', message: 'bad' });
    }
    const [e] = await listErrors(db, alice);
    expect(e!.count).toBe(3);
  });

  it('never throws, even when the database is gone', async () => {
    const broken = { query: () => Promise.reject(new Error('down')) } as never;
    await expect(
      recordError(broken, { source: 'x', kind: 'y', message: 'z' }),
    ).resolves.toBeUndefined();
  });
});

describe('stack summaries and fingerprints', () => {
  it('keeps the top lines and drops folders from this machine', () => {
    const stack = [
      'Error: boom',
      ...Array.from(
        { length: 9 },
        (_, i) => `    at fn${i} (/Users/x/proj/src/file${i}.ts:${i}:1)`,
      ),
    ].join('\n');
    const lines = stackSummary(stack)!.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('at fn0 (file0.ts:0:1)');
    expect(stackSummary(null)).toBeNull();
    expect(stackSummary('no frames here')).toBeNull();
  });

  it('treats numbers and ids in the text as the same failure', () => {
    const f = (message: string) => fingerprintOf({ source: 'run', kind: 'k', message });
    expect(f('step 12 of 40 failed for 11111111-2222-3333-4444-555555555555')).toBe(
      f('step 7 of 9 failed for aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    );
    expect(f('step failed')).not.toBe(f('step succeeded'));
  });
});

describe('provider health', () => {
  const decide = (n: number) => (n >= 3 ? ('down' as const) : ('degraded' as const));

  it('starts unknown, goes degraded then down, and recovers on the next good call', async () => {
    expect(await getProviderHealth(db, 'apify')).toBeNull();
    const f = { kind: 'server_error' as const, reason: 'Apify had a problem on its side' };
    expect((await markProviderFailed(db, 'apify', f, decide)).state).toBe('degraded');
    const second = await markProviderFailed(db, 'apify', f, decide);
    expect(second.state).toBe('degraded');
    const third = await markProviderFailed(db, 'apify', f, decide);
    expect(third.state).toBe('down');
    // "Since" stays at the first moment it left ok.
    expect(third.since).toBe(second.since);
    await markProviderOk(db, 'apify');
    expect(await getProviderHealth(db, 'apify')).toMatchObject({
      state: 'ok',
      reason: null,
      kind: null,
      since: null,
      consecutiveFailures: 0,
    });
  });
});
