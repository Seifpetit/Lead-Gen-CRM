import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

// Passwords: argon2id via the argon2 library (its defaults: 64 MiB, 3 passes, 4 lanes).
// Tokens: 256 random bits; only their SHA-256 is stored, so lookups need no slow hash.

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed stored hash (e.g. the seeded demo user's placeholder): never a match.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Burns the same time as a real check, so unknown emails can't be told apart by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
