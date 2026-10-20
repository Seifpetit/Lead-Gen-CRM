import { describe, expect, it, vi } from 'vitest';
import { createSentryReporter, parseDsn } from './sentry.js';

const DSN = 'https://abc123@o1.ingest.sentry.io/4567';
const event = (over = {}) => ({
  message: 'Apify is out of credit',
  source: 'provider',
  kind: 'out_of_credit',
  provider: 'apify',
  step: 'discover',
  fingerprint: 'fp1',
  ...over,
});

describe('optional Sentry reporting', () => {
  it('is off without a DSN, so nothing is ever sent', () => {
    const post = vi.fn();
    expect(createSentryReporter(undefined, [], post)).toBeNull();
    expect(createSentryReporter('', [], post)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('is off for a DSN that is not one', () => {
    expect(createSentryReporter('not a url')).toBeNull();
    expect(createSentryReporter('https://host/abc')).toBeNull();
    expect(parseDsn('ftp://k@h/1')).toBeNull();
  });

  it('reads the envelope address and key from the DSN', () => {
    expect(parseDsn(DSN)).toEqual({
      url: 'https://o1.ingest.sentry.io/api/4567/envelope/',
      key: 'abc123',
    });
  });

  it('sends the masked message and the kind, and nothing about users or runs', async () => {
    const post = vi.fn().mockResolvedValue({});
    const reporter = createSentryReporter(DSN, ['topsecretvalue1'], post)!;
    reporter.report(event({ message: 'failed with topsecretvalue1 and Bearer abcdef123456' }));
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0]!;
    expect(url).toBe('https://o1.ingest.sentry.io/api/4567/envelope/');
    expect(init.headers['x-sentry-auth']).toContain('sentry_key=abc123');
    const lines = (init.body as string).split('\n').map((l) => JSON.parse(l));
    expect(lines[2].message).toBe('failed with [hidden] and Bearer [hidden]');
    expect(lines[2].tags).toEqual({
      source: 'provider',
      kind: 'out_of_credit',
      provider: 'apify',
      step: 'discover',
    });
    expect(init.body).not.toContain('topsecretvalue1');
    expect(Object.keys(lines[2])).not.toContain('user');
  });

  it('sends each kind of failure once per process', () => {
    const post = vi.fn().mockResolvedValue({});
    const reporter = createSentryReporter(DSN, [], post)!;
    reporter.report(event());
    reporter.report(event());
    reporter.report(event({ fingerprint: 'fp2' }));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('never lets a failing send break the caller', async () => {
    const post = vi.fn().mockRejectedValue(new Error('offline'));
    const reporter = createSentryReporter(DSN, [], post)!;
    expect(() => reporter.report(event())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
