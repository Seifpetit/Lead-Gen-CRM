import { describe, expect, it } from 'vitest';
import { HttpError } from '../httpClient.js';
import { classifyProviderFailure, healthAfterFailure } from './providerFailure.js';

const http = (status: number, detail?: string) =>
  new HttpError(status, 'https://api.apify.com/v2/acts/x~y/runs?token=SECRET', detail);
const net = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const named = (name: string) => Object.assign(new Error('timed out'), { name });

describe('classifying a failed provider call', () => {
  it.each([
    [401, undefined, 'invalid_key'],
    [403, undefined, 'invalid_key'],
    [403, 'Monthly usage hard limit exceeded', 'quota_exceeded'],
    [403, 'You do not have enough credit', 'out_of_credit'],
    [402, undefined, 'out_of_credit'],
    [400, 'Your credit balance is too low', 'out_of_credit'],
    [429, undefined, 'rate_limited'],
    [429, 'Quota exceeded for this month', 'quota_exceeded'],
    [500, undefined, 'server_error'],
    [503, undefined, 'server_error'],
    [418, undefined, 'unknown'],
  ] as const)('HTTP %s (%s) is %s', (status, detail, kind) => {
    expect(classifyProviderFailure('apify', http(status, detail)).kind).toBe(kind);
  });

  it('tells timeouts and network failures apart', () => {
    expect(classifyProviderFailure('apify', named('TimeoutError')).kind).toBe('timeout');
    expect(classifyProviderFailure('apify', named('AbortError')).kind).toBe('timeout');
    expect(classifyProviderFailure('apify', net('ECONNREFUSED')).kind).toBe('network');
    expect(classifyProviderFailure('apify', new Error('boom')).kind).toBe('unknown');
  });

  it('says what to do about a key, credit or quota problem, in plain words', () => {
    expect(classifyProviderFailure('apify', http(402)).plain).toBe(
      'Apify is out of credit: top up and start a new run',
    );
    expect(classifyProviderFailure('anthropic', http(401)).plain).toBe(
      'Anthropic refused the key: check the key in your settings file, then start a new run',
    );
    expect(classifyProviderFailure('apify', http(403, 'usage limit reached')).plain).toContain(
      'usage limit',
    );
  });

  it('marks as safe to retry only what the provider certainly did not run', () => {
    const safe = (e: unknown) => classifyProviderFailure('apify', e).safeToRetry;
    expect(safe(http(429))).toBe(true);
    expect(safe(http(503))).toBe(true);
    expect(safe(http(502))).toBe(true);
    expect(safe(net('ECONNREFUSED'))).toBe(true);
    expect(safe(net('ENOTFOUND'))).toBe(true);
    // The request may have started a paid run: never repeat these.
    expect(safe(http(500))).toBe(false);
    expect(safe(named('TimeoutError'))).toBe(false);
    expect(safe(net('ECONNRESET'))).toBe(false);
    expect(safe(http(401))).toBe(false);
  });

  it('flags the failures that need a person', () => {
    const needs = (e: unknown) => classifyProviderFailure('apify', e).needsPerson;
    expect(needs(http(401))).toBe(true);
    expect(needs(http(402))).toBe(true);
    expect(needs(http(403, 'quota exceeded'))).toBe(true);
    expect(needs(http(503))).toBe(false);
    expect(needs(named('TimeoutError'))).toBe(false);
  });

  it('keeps the technical detail without a query string', () => {
    const f = classifyProviderFailure('apify', http(402, 'Not enough credit'));
    expect(f.detail).toContain('HTTP 402 from https://api.apify.com/v2/acts/x~y/runs');
    expect(f.detail).toContain('Not enough credit');
    expect(f.detail).not.toContain('SECRET');
  });

  it('sets the health state: down at once for a person to fix, degraded then down for hiccups', () => {
    const person = { needsPerson: true };
    const hiccup = { needsPerson: false };
    expect(healthAfterFailure(person, 1)).toBe('down');
    expect(healthAfterFailure(hiccup, 1)).toBe('degraded');
    expect(healthAfterFailure(hiccup, 2)).toBe('degraded');
    expect(healthAfterFailure(hiccup, 3)).toBe('down');
  });
});
