import { buildApp } from '../app.js';
import { AuthService, DEFAULT_POLICY } from '../auth/service.js';
import { openTestDb } from '../data/testDb.js';
import { setRegionBounds } from '../data/regions.js';
import { testRunner } from './testRunner.js';

// The backend for the browser smoke test (frontend/e2e): the real API and orchestrator on a
// real Postgres, with the fake Apify. Nothing here can reach Apify or spend money. It wipes
// the test database on start, so never point TEST_DATABASE_URL at data you care about.

const PORT = Number(process.env.E2E_PORT ?? 3000);
/** How often runs advance one poll. Fast enough that a run over every sector finishes in a minute, slow enough to catch mid-way. */
const TICK_MS = Number(process.env.E2E_TICK_MS ?? 200);

export const E2E_USER = { email: 'e2e@example.test', password: 'e2e-password-123' };

const db = await openTestDb();
await setRegionBounds(db, 'sfax', { south: 34.6, west: 10.5, north: 34.9, east: 10.9 });
await setRegionBounds(db, 'tunis', { south: 36.7, west: 10.0, north: 36.9, east: 10.3 });

const auth = new AuthService(db, { ...DEFAULT_POLICY });
await auth.createUserAsAdmin(E2E_USER.email, E2E_USER.password);

const world = testRunner(db, { polls: 3 }, { cellsPerRun: 2 });
const app = await buildApp({
  db,
  auth,
  runner: world.runner,
  paidRunsEnabled: true, // safe here: the providers are fakes
  webhookSecret: null,
});

// One pass at a time: on a slow machine a pass can outlast the interval, and two passes over
// the same run would start the same step twice (the second one marks it interrupted).
let polling = false;
setInterval(() => {
  if (polling) return;
  polling = true;
  world.runner
    .pollAll()
    .catch((err) => app.log.error({ err }, 'poll failed'))
    .finally(() => {
      polling = false;
    });
}, TICK_MS).unref();

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`e2e backend ready on ${PORT}`);
