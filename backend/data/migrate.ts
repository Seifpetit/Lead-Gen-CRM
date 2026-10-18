import { withTransaction, type Queryable } from './db.js';
import { migration as m001 } from './migrations/001_initial.js';
import { migration as m002 } from './migrations/002_auth.js';
import { migration as m003 } from './migrations/003_orchestrator.js';
import { migration as m006 } from './migrations/006_anthropic_provider.js';

export interface Migration {
  id: string;
  up: string;
  down: string;
}

/** All migrations, oldest first. Append new ones; never edit an applied one. */
export const MIGRATIONS: readonly Migration[] = [m001, m002, m003, m006];

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

async function applied(db: Queryable): Promise<string[]> {
  await db.query(ENSURE_TABLE);
  const { rows } = await db.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
  return rows.map((r) => r.id);
}

/** Applies every pending migration, each in its own transaction. Returns the IDs applied. */
export async function migrateUp(db: Queryable, migrations = MIGRATIONS): Promise<string[]> {
  const done = new Set(await applied(db));
  const ran: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await withTransaction(db, async (tx) => {
      await tx.query(m.up);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    ran.push(m.id);
  }
  return ran;
}

/** Rolls back the latest `steps` applied migrations (all of them when steps is Infinity). */
export async function migrateDown(
  db: Queryable,
  steps = 1,
  migrations = MIGRATIONS,
): Promise<string[]> {
  const done = (await applied(db)).reverse().slice(0, steps);
  const byId = new Map(migrations.map((m) => [m.id, m]));
  for (const id of done) {
    const m = byId.get(id);
    if (!m) throw new Error(`Applied migration ${id} is not in the migration list`);
    await withTransaction(db, async (tx) => {
      await tx.query(m.down);
      await tx.query('DELETE FROM schema_migrations WHERE id = $1', [id]);
    });
  }
  return done;
}
