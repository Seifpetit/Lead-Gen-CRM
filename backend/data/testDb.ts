import { createDb, type Db } from './db.js';
import { migrateDown, migrateUp } from './migrate.js';
import { seedReference } from './seed.js';
import { createUser } from './users.js';
import type { UserId } from './ids.js';

// Test helpers. Tests run against a real Postgres; see README "Tests" for setup.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://leadgen:leadgen@localhost:5432/leadgen_test';

export async function openTestDb(): Promise<Db> {
  const db = createDb(TEST_DATABASE_URL);
  try {
    await db.query('SELECT 1');
  } catch (err) {
    await db.end();
    throw new Error(
      `Cannot reach the test database at ${new URL(TEST_DATABASE_URL).host}. ` +
        'Start Postgres and create the leadgen_test database (see README).',
      { cause: err },
    );
  }
  // Fresh schema for each test file.
  await migrateDown(db, Infinity);
  await migrateUp(db);
  // No committed geometry: tests set the bounds they need, so they don't depend on real data.
  await seedReference(db, {});
  return db;
}

/** Empties every user-owned table (regions stay). */
export async function resetData(db: Db): Promise<void> {
  await db.query(
    'TRUNCATE users, suppression_list, login_failures, invites, app_errors, provider_health RESTART IDENTITY CASCADE',
  );
}

let counter = 0;
export async function makeUser(db: Db): Promise<UserId> {
  counter += 1;
  const user = await createUser(db, { email: `user${counter}@example.com`, passwordHash: 'x' });
  return user.id;
}
