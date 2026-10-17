import type { Queryable } from './db.js';
import { trustedUserId, type UserId } from './ids.js';

export interface User {
  id: UserId;
  email: string;
  createdAt: Date;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

interface Row {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

const toUser = (r: Row): User => ({
  id: trustedUserId(r.id),
  email: r.email,
  createdAt: r.created_at,
});

/** passwordHash must already be hashed (auth/, pass 2). This module never sees a password. */
export async function createUser(
  db: Queryable,
  input: { email: string; passwordHash: string },
): Promise<User> {
  const { rows } = await db.query<Row>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
    [input.email.trim(), input.passwordHash],
  );
  return toUser(rows[0]!);
}

/** For sign-in only: the one lookup that does not start from a UserId. */
export async function findUserByEmail(db: Queryable, email: string): Promise<UserWithHash | null> {
  const { rows } = await db.query<Row>('SELECT * FROM users WHERE lower(email) = lower($1)', [
    email.trim(),
  ]);
  const r = rows[0];
  return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
}

export async function getUser(db: Queryable, userId: UserId): Promise<User | null> {
  const { rows } = await db.query<Row>('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] ? toUser(rows[0]) : null;
}
