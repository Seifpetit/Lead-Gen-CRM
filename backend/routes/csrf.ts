import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { SESSION_COOKIE, currentUser } from '../auth/plugin.js';

// CSRF protection. Login uses a SameSite=Strict cookie, which already stops most cross-site
// requests; this adds two independent checks so a browser quirk or a same-site subdomain
// can't make a state-changing request on a user's behalf:
//
//  1. Every POST, PUT, PATCH and DELETE on an authenticated route must carry
//     `x-csrf-token`, a value derived from the session cookie. A page on another origin can
//     neither read the cookie (httpOnly) nor the token (no CORS), so it can't build one.
//  2. If the request carries an `Origin` header, it must match the Host. This also covers
//     the public sign-in routes, where there is no session to derive a token from yet.
//
// GET requests never change state, so they need neither. The Apify webhook opts out
// (`config: { csrf: false }`) because it is called by Apify, not a browser, and carries its
// own signature.

export const CSRF_HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set false only for server-to-server routes that verify their own signature. */
    csrf?: boolean;
  }
}

/** The CSRF token for a session: derived from its cookie value, never stored. */
export function csrfTokenFor(sessionToken: string): string {
  return createHash('sha256').update(`csrf:${sessionToken}`).digest('base64url');
}

/** Compares the Origin with the Host header, ignoring an explicit default port on either. */
function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    if (host === undefined) return false;
    const o = new URL(origin);
    return o.host === new URL(`${o.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function csrfPlugin(app: FastifyInstance): Promise<void> {
  // Registered after the auth plugin, so unauthenticated calls get 401 before this runs.
  app.addHook('onRequest', async (request, reply) => {
    if (SAFE.has(request.method) || request.routeOptions.config.csrf === false) return;

    const origin = request.headers.origin;
    if (origin !== undefined && !sameOrigin(origin, request.headers.host)) {
      return reply.code(403).send({ error: 'csrf_origin_mismatch' });
    }
    if (request.routeOptions.config.public) return;

    const sent = request.headers[CSRF_HEADER];
    const session = request.cookies[SESSION_COOKIE];
    if (typeof sent !== 'string' || !session || !equal(sent, csrfTokenFor(session))) {
      return reply.code(403).send({ error: 'csrf_token_invalid' });
    }
  });

  app.get('/api/auth/csrf', async (request, reply) => {
    currentUser(request);
    const session = request.cookies[SESSION_COOKIE];
    reply.header('cache-control', 'no-store');
    return { token: csrfTokenFor(session!) };
  });
}

export default fp(csrfPlugin, { name: 'csrf', dependencies: ['auth'] });
