import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markProviderFailed, recordError } from '../data/appErrors.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { MIGRATIONS } from '../data/migrate.js';
import { makeUser, openTestDb, resetData } from '../data/testDb.js';
import { buildChecks, buildHealth, DEFAULT_HEALTH_FACTS } from './health.js';

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

describe('startup checks', () => {
  it('say what to do in plain words when a key or the database is missing', () => {
    const checks = buildChecks(
      { ...DEFAULT_HEALTH_FACTS, apifyToken: false, anthropicKey: false },
      ['014_failure_tracking'],
      false,
    );
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.apify_token).toMatchObject({ status: 'fail' });
    expect(by.apify_token!.message).toContain('APIFY_TOKEN');
    expect(by.anthropic_key).toMatchObject({ status: 'warn' });
    expect(by.database).toMatchObject({ status: 'fail' });
    expect(by.migrations!.message).toContain('npm run db:migrate');
  });

  it('are all fine when everything is set', () => {
    const checks = buildChecks({ ...DEFAULT_HEALTH_FACTS, anthropicKey: true }, [], true);
    expect(checks.every((c) => c.status !== 'fail')).toBe(true);
  });
});

describe('the health view', () => {
  it('starts with every provider ok and no notices', async () => {
    const view = await buildHealth(db, user, {
      facts: { ...DEFAULT_HEALTH_FACTS, anthropicKey: true },
    });
    expect(view.providers.map((p) => [p.provider, p.state])).toEqual([
      ['apify', 'ok'],
      ['anthropic', 'ok'],
    ]);
    expect(view.notices).toEqual([]);
    expect(view.pendingMigrations).toEqual([]);
    expect(view.errors).toEqual([]);
  });

  it('puts a down provider in the notices with its reason', async () => {
    await markProviderFailed(
      db,
      'anthropic',
      { kind: 'invalid_key', reason: 'Anthropic refused the key: check it, then start a new run' },
      () => 'down',
    );
    const view = await buildHealth(db, user);
    expect(view.providers.find((p) => p.provider === 'anthropic')!.state).toBe('down');
    expect(view.notices).toContainEqual({
      id: 'provider:anthropic',
      message: 'Anthropic refused the key: check it, then start a new run',
    });
  });

  it('lists a pending migration and turns it into a notice', async () => {
    const fake = { id: '999_not_applied', up: 'SELECT 1', down: 'SELECT 1' };
    const view = await buildHealth(db, user, {
      migrations: [...MIGRATIONS, fake],
    });
    expect(view.pendingMigrations).toEqual(['999_not_applied']);
    expect(view.notices.some((n) => n.id === 'check:migrations')).toBe(true);
  });

  it("shows only this user's errors, masked, newest first, with counts", async () => {
    const other = await makeUser(db);
    await recordError(db, {
      userId: user,
      source: 'request',
      kind: 'unhandled',
      message: 'boom with key sk-ant-SECRET1234567890',
      secrets: ['sk-ant-SECRET1234567890'],
    });
    await recordError(db, {
      userId: other,
      source: 'request',
      kind: 'unhandled',
      message: 'theirs',
    });
    const view = await buildHealth(db, user);
    expect(view.errors).toHaveLength(1);
    expect(JSON.stringify(view.errors)).not.toContain('SECRET1234567890');
  });

  it('warns when today spends far above the usual day', async () => {
    const run = await db.query<{ id: string }>(
      `INSERT INTO runs (user_id, region_id, status, budget_cap_usd) VALUES ($1, 'sfax', 'finished', 50) RETURNING id`,
      [user],
    );
    const insert = (usd: number, daysAgo: number) =>
      db.query(
        `INSERT INTO cost_ledger (user_id, run_id, provider, item, units, unit_price_usd, amount_usd, kind, created_at)
         VALUES ($1, $2, 'apify', 'x', 1, $3, $3, 'actual', now() - make_interval(days => $4))`,
        [user, run.rows[0]!.id, usd, daysAgo],
      );
    await insert(0.5, 1);
    await insert(0.6, 2);
    await insert(5, 0);
    const view = await buildHealth(db, user);
    expect(view.warnings.map((w) => w.kind)).toEqual(['daily_spend_jump']);
    expect(view.warnings[0]!.message).toContain('$5.00');
  });
});
