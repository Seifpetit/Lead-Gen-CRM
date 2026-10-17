import pg from 'pg';

// The only module family allowed to import the database driver (enforced by ESLint).
export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}
