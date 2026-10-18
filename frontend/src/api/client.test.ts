import { describe, expect, it, vi } from 'vitest';
import { fakeServer } from '../test/fakeServer.js';
import { ApiRequestError, CSRF_HEADER } from './client.js';

describe('ApiClient', () => {
  it('reads without a CSRF token and sends the session cookie', async () => {
    const server = fakeServer({ 'GET /api/auth/me': { id: 'u1', email: 'a@example.test' } });
    await server.api.auth.me();
    expect(server.to('GET /api/auth/csrf')).toHaveLength(0);
    expect(server.calls[0]!.headers.get(CSRF_HEADER)).toBeNull();
  });

  it('adds the CSRF token to state-changing requests and fetches it once', async () => {
    const server = fakeServer({
      'POST /api/runs/run-1/stop': { body: {} },
      'PATCH /api/leads/l1/stage': { body: {} },
    });
    await server.api.runs.stop('run-1');
    await server.api.leads.move('l1', 'confirmed');
    expect(server.to('GET /api/auth/csrf')).toHaveLength(1);
    for (const key of ['POST /api/runs/run-1/stop', 'PATCH /api/leads/l1/stage']) {
      expect(server.to(key)[0]!.headers.get(CSRF_HEADER)).toBe('csrf-test-token');
    }
  });

  it('signs in and out without a token, since there is no session to derive one from', async () => {
    const server = fakeServer({
      'POST /api/auth/login': { status: 204 },
      'POST /api/auth/logout': { status: 204 },
    });
    await server.api.auth.login('a@example.test', 'pw');
    await server.api.auth.logout();
    expect(server.to('GET /api/auth/csrf')).toHaveLength(0);
    expect(server.to('POST /api/auth/login')[0]!.body).toEqual({
      email: 'a@example.test',
      password: 'pw',
    });
  });

  it('forgets the token on sign-in so the next session gets its own', async () => {
    const server = fakeServer({
      'POST /api/auth/login': { status: 204 },
      'POST /api/runs/r/stop': { body: {} },
    });
    await server.api.runs.stop('r');
    await server.api.auth.login('a@example.test', 'pw');
    await server.api.runs.stop('r');
    expect(server.to('GET /api/auth/csrf')).toHaveLength(2);
  });

  it('refreshes a stale token once and retries', async () => {
    let tokens = 0;
    let attempts = 0;
    const server = fakeServer({
      'GET /api/auth/csrf': () => ({ token: `t${++tokens}` }),
      'POST /api/runs/r/stop': (req) => {
        attempts++;
        return req.headers.get(CSRF_HEADER) === 't2'
          ? { body: {} }
          : { status: 403, body: { error: 'csrf_token_invalid' } };
      },
    });
    await expect(server.api.runs.stop('r')).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });

  it('does not loop when the token is refused again', async () => {
    const server = fakeServer({
      'POST /api/runs/r/stop': { status: 403, body: { error: 'csrf_token_invalid' } },
    });
    await expect(server.api.runs.stop('r')).rejects.toMatchObject({ status: 403 });
    expect(server.to('POST /api/runs/r/stop')).toHaveLength(2);
  });

  it('tells listeners when the session ended, but not for a failed sign-in', async () => {
    const server = fakeServer({
      'GET /api/runs': { status: 401, body: { error: 'unauthenticated' } },
      'POST /api/auth/login': { status: 401, body: { error: 'invalid_credentials' } },
    });
    const ended = vi.fn();
    server.client.onUnauthenticated(ended);
    await expect(server.api.auth.login('a@example.test', 'bad')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(ended).not.toHaveBeenCalled();
    await expect(server.api.runs.list()).rejects.toBeInstanceOf(ApiRequestError);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('keeps the server code, message, issues and retry delay on errors', async () => {
    const server = fakeServer({
      'POST /api/auth/login': {
        status: 429,
        headers: { 'retry-after': '120' },
        body: { error: 'too_many_attempts' },
      },
      'POST /api/runs': {
        status: 400,
        body: {
          error: 'invalid_request',
          message: 'Bad',
          issues: [{ path: 'budgetCapUsd', message: 'Required' }],
        },
      },
    });
    const limited = await server.api.auth.login('a@example.test', 'pw').catch((e: unknown) => e);
    expect(limited).toMatchObject({
      status: 429,
      code: 'too_many_attempts',
      retryAfterSeconds: 120,
    });
    const invalid = await server.api.runs
      .start({ regionId: 'sfax', budgetCapUsd: 1, confirm: true })
      .catch((e: unknown) => e);
    expect(invalid).toMatchObject({
      code: 'invalid_request',
      details: { issues: [{ path: 'budgetCapUsd' }] },
    });
  });

  it('reports an unreachable server as status 0', async () => {
    const server = fakeServer({});
    const broken = new (server.client.constructor as typeof import('./client.js').ApiClient)({
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    await expect(broken.get('/api/runs')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('sends lists comma-separated and drops undefined parameters', async () => {
    const server = fakeServer({ 'GET /api/leads': { body: { items: [], total: 0 } } });
    await server.api.leads.list({
      stage: ['confirmed', 'contacted'],
      runId: undefined,
      limit: 5,
    } as never);
    const q = server.calls[0]!.query;
    expect(q.get('stage')).toBe('confirmed,contacted');
    expect(q.has('runId')).toBe(false);
    expect(q.get('limit')).toBe('5');
  });
});
