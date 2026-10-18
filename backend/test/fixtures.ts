import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { RequestOptions } from '../httpClient.js';
import type { HttpJson } from '../providers/http.js';

const FIXTURES = new URL('../providers/fixtures/', import.meta.url);

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
}

export interface RecordedCall {
  url: string;
  options: RequestOptions;
}

type Route = [
  match: RegExp | ((url: string, options: RequestOptions) => boolean),
  respond: unknown,
];

/**
 * An HttpJson that serves fixtures by URL and records every call. An unmatched request throws,
 * so a test can never reach a real API.
 */
export function fakeHttp(routes: Route[]): HttpJson & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const http = (async (url: string, options: RequestOptions = {}) => {
    calls.push({ url, options });
    for (const [match, respond] of routes) {
      const ok = match instanceof RegExp ? match.test(url) : match(url, options);
      if (ok) {
        const value = typeof respond === 'function' ? respond(url, options, calls.length) : respond;
        return structuredClone(value);
      }
    }
    throw new Error(`fakeHttp: no fixture for ${options.method ?? 'GET'} ${url}`);
  }) as HttpJson & { calls: RecordedCall[] };
  http.calls = calls;
  return http;
}

/** Makes any real network call in the test file fail loudly. */
export function blockNetwork(): void {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network is blocked in provider and stage tests');
  });
}

export const FIXED_NOW = new Date('2026-10-17T12:00:00.000Z');
export const clock = () => FIXED_NOW;
