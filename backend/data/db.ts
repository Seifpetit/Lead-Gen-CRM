import pg from 'pg';

// The only module family allowed to import the database driver (enforced by ESLint).

// Return numeric columns as JS numbers. Values here are money and shares well within
// double precision; bigint ids are returned as strings by default and stay that way.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export type Db = pg.Pool;
/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function withTransaction<T>(
  db: Queryable,
  fn: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  // Already inside a transaction: join it.
  if (!(db instanceof pg.Pool)) return fn(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
