import { ApiClient } from '../api/client.js';
import { createApi } from '../api/endpoints.js';
import { health } from './fixtures.js';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
}
export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
/** A body, a { status, body, headers } reply, or a function returning either. */
export type Handler = object | ((req: FakeRequest) => unknown);

const isReply = (v: unknown): v is FakeReply =>
  typeof v === 'object' &&
  v !== null &&
  ('status' in v || 'headers' in v || 'body' in v) &&
  !Array.isArray(v);

/**
 * A stand-in for the backend: routes are "METHOD /path" keys. A handler returns a body (200),
 * or { status, body, headers }. Every request is recorded in `calls`. Unknown routes fail the
 * test loudly rather than answering with something plausible.
 */
export function fakeServer(routes: Record<string, Handler>) {
  const calls: FakeRequest[] = [];
  const table: Record<string, Handler> = {
    'GET /api/auth/csrf': { body: { token: 'csrf-test-token' } },
    // The in-app notice asks for this on every screen; healthy unless a test says otherwise.
    'GET /api/health': { body: health() },
    ...routes,
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const req: FakeRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers,
    };
    calls.push(req);
    const handler = table[`${method} ${url.pathname}`];
    if (handler === undefined) {
      throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
    }
    const out: unknown = typeof handler === 'function' ? handler(req) : handler;
    const reply: FakeReply = isReply(out) ? out : { body: out };
    const status = reply.status ?? (reply.body === undefined ? 204 : 200);
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  const client = new ApiClient({ fetch: fetchImpl });
  return {
    calls,
    client,
    api: createApi(client),
    /** Requests matching "METHOD /path". */
    to: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
    set: (key: string, handler: Handler) => {
      table[key] = handler;
    },
  };
}
export type FakeServer = ReturnType<typeof fakeServer>;
