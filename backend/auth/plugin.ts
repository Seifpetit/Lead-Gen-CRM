import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthConfig } from '@lead-gen-crm/shared';
import { z } from 'zod';
import type { UserId } from '../data/ids.js';
import type { AuthService } from './service.js';

export const SESSION_COOKIE = 'sid';

export interface AuthUser {
  id: UserId;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on every non-public route; null only on public routes. */
    user: AuthUser | null;
  }
  interface FastifyContextConfig {
    /** Routes are authenticated unless they opt out with `config: { public: true }`. */
    public?: boolean;
  }
}

/** The signed-in user. Only call from authenticated routes (the default). */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new Error('currentUser called on an unauthenticated request');
  return request.user;
}

// The email format is checked in the handlers so the dev shortcut's `test` login can pass.
const Credentials = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});
const Signup = Credentials.extend({ inviteCode: z.string().min(1).max(200).optional() });

const EmailFormat = z.string().email();

/** Sign-up: email-shaped, or the dev shortcut's exact test/test pair. */
function validSignup(auth: AuthService, email: string, password: string): boolean {
  return EmailFormat.safeParse(email).success || auth.isDevAdminPair(email, password);
}

/** Sign-in: email-shaped, or the reserved dev login (any password; it is checked as usual). */
function validSignIn(auth: AuthService, email: string): boolean {
  return EmailFormat.safeParse(email).success || auth.isDevAdminLogin(email);
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
}

async function authPlugin(app: FastifyInstance, opts: { auth: AuthService }): Promise<void> {
  const { auth } = opts;
  await app.register(cookie);
  app.decorateRequest('user', null);

  // Fail closed: every route, including unknown ones, requires a session unless marked public.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config.public) return;
    const session = await auth.authenticate(request.cookies[SESSION_COOKIE]);
    if (!session) {
      clearSessionCookie(reply);
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    request.user = { id: session.userId, email: session.email };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (request, reply) => {
    const body = Credentials.safeParse(request.body);
    if (!body.success || !validSignIn(auth, body.data.email)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const result = await auth.login(body.data.email, body.data.password, request.ip);
    if (!result.ok && result.reason === 'locked') {
      reply.header('retry-after', Math.ceil((result.retryAfterMs ?? 0) / 1000));
      return reply.code(429).send({ error: 'too_many_attempts' });
    }
    if (!result.ok) return reply.code(401).send({ error: 'invalid_credentials' });
    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.code(204).send();
  });

  app.post('/api/auth/signup', { config: { public: true } }, async (request, reply) => {
    const body = Signup.safeParse(request.body);
    if (!body.success || !validSignup(auth, body.data.email, body.data.password)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { email, password, inviteCode } = body.data;
    const result = await auth.signup(email, password, inviteCode);
    if (!result.ok) {
      const status = {
        invite_required: 403,
        invalid_invite: 403,
        weak_password: 400,
        email_taken: 409,
      }[result.reason];
      return reply.code(status).send({ error: result.reason });
    }
    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.code(201).send({ id: result.userId, email });
  });

  // Public so a client with an already-expired session can still clear its cookie.
  app.post('/api/auth/logout', { config: { public: true } }, async (request, reply) => {
    await auth.logout(request.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // Public: the sign-in screen needs it before there is a session.
  app.get('/api/auth/config', { config: { public: true } }, async (): Promise<AuthConfig> => {
    return {
      signupMode: auth.policy.signupMode,
      minPasswordLength: auth.policy.minPasswordLength,
      devAdminLogin: auth.policy.devAdminLogin,
    };
  });

  app.get('/api/auth/me', async (request) => currentUser(request));
}

export default fp(authPlugin, { name: 'auth' });
