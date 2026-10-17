import type { Db } from '../data/db.js';
import { withTransaction } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { consumeInvite, createInvite, markInviteUsedBy } from '../data/invites.js';
import {
  clearLoginFailures,
  countLoginFailures,
  recordLoginFailure,
} from '../data/loginFailures.js';
import { createSession, deleteSession, touchSession, type Session } from '../data/sessions.js';
import { createUser, findUserByEmail } from '../data/users.js';
import { hashPassword, hashToken, newToken, verifyAgainstDummy, verifyPassword } from './crypto.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface AuthPolicy {
  signupMode: 'invite' | 'open';
  sessionIdleMs: number;
  sessionMaxMs: number;
  /** Failed sign-ins for one email within the window before it locks. */
  maxFailuresPerEmail: number;
  /** Failed sign-ins from one IP within the window before it is throttled. */
  maxFailuresPerIp: number;
  failureWindowMs: number;
  lockoutMs: number;
  minPasswordLength: number;
  inviteTtlMs: number;
}

export const DEFAULT_POLICY: AuthPolicy = {
  signupMode: 'invite',
  sessionIdleMs: 12 * HOUR,
  sessionMaxMs: 7 * 24 * HOUR,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
  failureWindowMs: 15 * MINUTE,
  lockoutMs: 15 * MINUTE,
  minPasswordLength: 12,
  inviteTtlMs: 7 * 24 * HOUR,
};

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: UserId }
  | { ok: false; reason: 'invalid' | 'locked'; retryAfterMs?: number };

export type SignupResult =
  | { ok: true; token: string; expiresAt: Date; userId: UserId }
  | { ok: false; reason: 'invite_required' | 'invalid_invite' | 'weak_password' | 'email_taken' };

export class AuthService {
  constructor(
    private readonly db: Db,
    readonly policy: AuthPolicy = DEFAULT_POLICY,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async startSession(userId: UserId): Promise<{ token: string; expiresAt: Date }> {
    const now = this.now();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + this.policy.sessionMaxMs);
    await createSession(this.db, userId, { tokenHash: hashToken(token), now, expiresAt });
    return { token, expiresAt };
  }

  /**
   * Checks lockout before the password, so a correct password is still refused while locked.
   * Unknown emails take the same path and time as wrong passwords.
   */
  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    const now = this.now();
    const p = this.policy;
    const failures = await countLoginFailures(this.db, {
      email,
      ip,
      since: new Date(now.getTime() - p.failureWindowMs),
    });
    if (failures.byIp >= p.maxFailuresPerIp) {
      return { ok: false, reason: 'locked', retryAfterMs: p.failureWindowMs };
    }
    if (failures.byEmail >= p.maxFailuresPerEmail && failures.lastEmailFailure) {
      const lockedUntil = failures.lastEmailFailure.getTime() + p.lockoutMs;
      if (lockedUntil > now.getTime()) {
        return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - now.getTime() };
      }
    }

    const user = await findUserByEmail(this.db, email);
    const valid = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !valid) {
      await recordLoginFailure(this.db, { email, ip, at: now });
      return { ok: false, reason: 'invalid' };
    }
    await clearLoginFailures(this.db, email);
    return { ok: true, userId: user.id, ...(await this.startSession(user.id)) };
  }

  /** Resolves a cookie token to its session, applying idle and absolute expiry. */
  async authenticate(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const now = this.now();
    return touchSession(
      this.db,
      hashToken(token),
      now,
      new Date(now.getTime() - this.policy.sessionIdleMs),
    );
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await deleteSession(this.db, hashToken(token));
  }

  async signup(email: string, password: string, inviteCode?: string): Promise<SignupResult> {
    if (password.length < this.policy.minPasswordLength)
      return { ok: false, reason: 'weak_password' };
    if (this.policy.signupMode === 'invite' && !inviteCode)
      return { ok: false, reason: 'invite_required' };
    const passwordHash = await hashPassword(password);
    const now = this.now();
    try {
      const userId = await withTransaction(this.db, async (tx) => {
        const codeHash = inviteCode ? hashToken(inviteCode) : null;
        if (this.policy.signupMode === 'invite' && !(await consumeInvite(tx, codeHash!, now))) {
          throw new SignupRefused('invalid_invite');
        }
        if (await findUserByEmail(tx, email)) throw new SignupRefused('email_taken');
        const user = await createUser(tx, { email, passwordHash });
        if (codeHash && this.policy.signupMode === 'invite')
          await markInviteUsedBy(tx, codeHash, user.id);
        return user.id;
      });
      return { ok: true, userId, ...(await this.startSession(userId)) };
    } catch (err) {
      if (err instanceof SignupRefused) return { ok: false, reason: err.reason };
      throw err;
    }
  }

  /** Admin path (CLI): creates a user directly, bypassing the sign-up mode. */
  async createUserAsAdmin(email: string, password: string): Promise<UserId> {
    if (password.length < this.policy.minPasswordLength) {
      throw new Error(`Password must be at least ${this.policy.minPasswordLength} characters`);
    }
    const user = await createUser(this.db, { email, passwordHash: await hashPassword(password) });
    return user.id;
  }

  /** Admin path (CLI): returns a new one-time invite code. Only its hash is stored. */
  async createInvite(): Promise<{ code: string; expiresAt: Date }> {
    const code = newToken();
    const expiresAt = new Date(this.now().getTime() + this.policy.inviteTtlMs);
    await createInvite(this.db, { codeHash: hashToken(code), expiresAt });
    return { code, expiresAt };
  }
}

class SignupRefused extends Error {
  constructor(readonly reason: 'invalid_invite' | 'email_taken') {
    super(reason);
  }
}
