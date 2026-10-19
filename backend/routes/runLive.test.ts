import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiveRuns, RunLogPage, RunSummary } from '@lead-gen-crm/shared';
import { buildApp } from '../app.js';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { AuthService, DEFAULT_POLICY } from '../auth/service.js';
import type { Db } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { createRegionGrid } from '../data/regionCells.js';
import { setRegionBounds } from '../data/regions.js';
import { appendRunLog } from '../data/runLog.js';
import { openTestDb, resetData } from '../data/testDb.js';
import { testRunner } from '../test/testRunner.js';

// The live view of runs: the sentence each step says, the log behind it, the polling
// fallback and the event stream. Runs go through the fake Apify, so nothing here spends money.

const PASSWORD = 'correct horse battery';
const SFAX = { south: 34.6, west: 10.5, north: 34.9, east: 10.9 };
const TOKEN = 'apify_api_SuperSecretToken1234567890';

let db: Db;
let app: FastifyInstance;
let auth: AuthService;
let world: ReturnType<typeof testRunner>;
let alice: { id: UserId; token: string };
let bob: { id: UserId; token: string };
const apps: FastifyInstance[] = [];

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

async function signIn(email: string) {
  const id = await auth.createUserAsAdmin(email, PASSWORD);
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  return { id, token: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
}

const get = <T>(who: { token: string } | null, url: string) =>
  app
    .inject({ method: 'GET', url, ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}) })
    .then((res) => ({ status: res.statusCode, body: res.json() as T }));

async function drive(user: UserId, runId: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const r = await world.runner.advance(user, runId);
    if (r.status !== 'running' && r.status !== 'pending' && r.inFlight === 0) return;
  }
  throw new Error('run did not settle');
}

const startRun = (user: UserId) =>
  world.runner.startRun(user, { regionId: 'sfax', sectorIds: ['textile'], budgetCapUsd: 10 });

beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  world = testRunner(db, { polls: 1 });
  auth = new AuthService(db, { ...DEFAULT_POLICY });
  app = await buildApp({
    db,
    auth,
    runner: world.runner,
    paidRunsEnabled: true,
    secrets: ['my-private-value-42'],
  });
  apps.push(app);
  await setRegionBounds(db, 'sfax', SFAX);
  await createRegionGrid(db, 'sfax', SFAX, 1, 2);
  alice = await signIn('alice@example.com');
  bob = await signIn('bob@example.com');
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

describe('the sentences a run says', () => {
  it('starts with what it searches and where, and ends with how many leads are ready', async () => {
    const run = await startRun(alice.id);
    const started = await get<{ runs: RunSummary[] }>(alice, '/api/runs/live');
    expect(started.body.runs[0]!.liveMessage).toBe(
      'Searching Google Maps for textile and clothing companies in Sfax...',
    );

    await drive(alice.id, run.id);
    const logs = await get<RunLogPage>(alice, `/api/runs/${run.id}/logs`);
    const said = logs.body.items.filter((l) => !l.technical).map((l) => l.message);
    expect(said[0]).toBe('Searching Google Maps for textile and clothing companies in Sfax...');
    expect(
      said.some((m) => /^Found \d+ compan(y|ies), checking which ones move goods\.\.\.$/.test(m)),
    ).toBe(true);
    expect(
      said.some((m) => m.startsWith('Looking up') || m.includes('Looking up the people')),
    ).toBe(true);
    expect(said.at(-1)).toMatch(/^Done\. (\d+ leads? (is|are) ready|No leads this time)\.$/);

    const summary = (await get<RunSummary>(alice, `/api/runs/${run.id}`)).body;
    expect(summary.liveMessage).toBe(said.at(-1));
    expect(summary.status).toBe('finished');
  });

  it('never uses the internal step names in the sentences', async () => {
    const run = await startRun(alice.id);
    await drive(alice.id, run.id);
    const logs = (await get<RunLogPage>(alice, `/api/runs/${run.id}/logs`)).body.items;
    for (const line of logs.filter((l) => !l.technical)) {
      for (const word of [
        'Discover',
        'Enriched',
        'Unreachable',
        'find_people',
        'enrich',
        'qualify',
      ]) {
        expect(line.message, line.message).not.toContain(word);
      }
    }
  });

  it('keeps the technical detail in the log, with levels and times, oldest first', async () => {
    const run = await startRun(alice.id);
    await drive(alice.id, run.id);
    const items = (await get<RunLogPage>(alice, `/api/runs/${run.id}/logs`)).body.items;
    expect(
      items.some(
        (l) => l.technical && /^Search ".+" in area r\dc\d: \d+ places returned/.test(l.message),
      ),
    ).toBe(true);
    expect(items.some((l) => l.technical && l.message.includes('Apify run finished'))).toBe(true);
    expect(items.every((l) => ['info', 'warn', 'error'].includes(l.level))).toBe(true);
    expect(items.map((l) => l.id)).toEqual([...items.map((l) => l.id)].sort((a, b) => a - b));
    expect(Number.isNaN(Date.parse(items[0]!.at))).toBe(false);
  });

  it('returns only newer lines after a cursor, and pages with hasMore', async () => {
    const run = await startRun(alice.id);
    await drive(alice.id, run.id);
    const all = (await get<RunLogPage>(alice, `/api/runs/${run.id}/logs`)).body;
    expect(all.hasMore).toBe(false);
    const first = (await get<RunLogPage>(alice, `/api/runs/${run.id}/logs?limit=3`)).body;
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const rest = (
      await get<RunLogPage>(
        alice,
        `/api/runs/${run.id}/logs?after=${first.items[2]!.id}&limit=1000`,
      )
    ).body;
    expect([...first.items, ...rest.items]).toEqual(all.items);
    const none = (
      await get<RunLogPage>(alice, `/api/runs/${run.id}/logs?after=${all.items.at(-1)!.id}`)
    ).body;
    expect(none).toEqual({ items: [], hasMore: false });
  });

  it('says the run was stopped, and how many leads were kept', async () => {
    const run = await startRun(alice.id);
    await world.runner.stopRun(alice.id, run.id);
    const summary = (await get<RunSummary>(alice, `/api/runs/${run.id}`)).body;
    expect(summary.liveMessage).toMatch(/^Stopped\. \d+ leads? w(as|ere) kept\.$/);
  });

  it('is the user’s own: another user gets a 404 for the log', async () => {
    const run = await startRun(alice.id);
    expect((await get(bob, `/api/runs/${run.id}/logs`)).status).toBe(404);
  });
});

describe('GET /api/runs/live', () => {
  it('lists the runs in progress only, with progress inputs, and nothing for another user', async () => {
    const run = await startRun(alice.id);
    const live = (await get<LiveRuns>(alice, '/api/runs/live')).body;
    expect(live.runs.map((r) => r.id)).toEqual([run.id]);
    expect(live.runs[0]).toMatchObject({ status: 'running', currentStage: 'discover' });
    expect(live.runs[0]!.stageFraction).toBeGreaterThanOrEqual(0);
    expect(live.runs[0]!.stageFraction).toBeLessThanOrEqual(1);
    expect((await get<LiveRuns>(bob, '/api/runs/live')).body.runs).toEqual([]);
    await drive(alice.id, run.id);
    expect((await get<LiveRuns>(alice, '/api/runs/live')).body.runs).toEqual([]);
  });

  it('needs a session', async () => {
    expect((await get(null, '/api/runs/live')).status).toBe(401);
  });
});

describe('secrets in the log', () => {
  it('are hidden when written and again when read', async () => {
    const run = await startRun(alice.id);
    await appendRunLog(db, alice.id, {
      runId: run.id,
      technical: true,
      level: 'error',
      message: `GET https://api.apify.com/v2/acts?token=${TOKEN} failed`,
    });
    // A value the process holds, stored by an older version that did not know it.
    await db.query(
      `INSERT INTO run_log (user_id, run_id, technical, message)
       VALUES ($1, $2, true, 'quoted my-private-value-42 in an error')`,
      [alice.id, run.id],
    );
    const text = JSON.stringify((await get<RunLogPage>(alice, `/api/runs/${run.id}/logs`)).body);
    expect(text).not.toContain('SuperSecretToken');
    expect(text).not.toContain('my-private-value-42');
    expect(text).toContain('[hidden]');
    const stored = (await db.query<{ message: string }>('SELECT message FROM run_log')).rows
      .map((r) => r.message)
      .join('\n');
    expect(stored).not.toContain('SuperSecretToken');
  });
});

/** Reads server-sent events from a real connection; the stream never ends on its own. */
async function openStream(port: number, token: string | null) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/runs/stream`, {
    signal: controller.signal,
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
  const events: { event: string; data: LiveRuns }[] = [];
  let raw = '';
  let comments = 0;
  const done = (async () => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        raw += decoder.decode(value, { stream: true });
        let at: number;
        while ((at = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, at);
          raw = raw.slice(at + 2);
          if (block.startsWith(':')) comments++;
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) as LiveRuns });
        }
      }
    } catch {
      // Aborted by the test.
    }
  })();
  return {
    res,
    events,
    comments: () => comments,
    close: async () => {
      controller.abort();
      await done;
    },
  };
}

async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('GET /api/runs/stream', () => {
  it('is refused without a session', async () => {
    const res = await get(null, '/api/runs/stream');
    expect(res.status).toBe(401);
  });

  it('sends the runs in progress as an event, then every change, for that user only', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const mine = await openStream(port, alice.token);
    const others = await openStream(port, bob.token);
    try {
      expect(mine.res.status).toBe(200);
      expect(mine.res.headers.get('content-type')).toContain('text/event-stream');
      await until(() => mine.events.length > 0 && others.events.length > 0);
      expect(mine.events[0]!.event).toBe('runs');
      expect(mine.events[0]!.data.runs).toEqual([]);

      const run = await startRun(alice.id);
      await until(() => mine.events.some((e) => e.data.runs.some((r) => r.id === run.id)));
      const latest = mine.events.at(-1)!.data.runs[0]!;
      expect(latest.liveMessage).toBe(
        'Searching Google Maps for textile and clothing companies in Sfax...',
      );

      await drive(alice.id, run.id);
      await until(() => mine.events.at(-1)!.data.runs.length === 0);
      // Bob never sees Alice's run.
      expect(others.events.every((e) => e.data.runs.length === 0)).toBe(true);
    } finally {
      await mine.close();
      await others.close();
    }
  });
});
