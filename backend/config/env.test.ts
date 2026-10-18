import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';

const valid = {
  APIFY_TOKEN: 'apify_api_secret',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};

describe('loadEnv', () => {
  it('returns typed config with defaults', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      PAID_RUNS_ENABLED: false,
      PORT: 3000,
      NODE_ENV: 'development',
      SIGNUP_MODE: 'invite',
      SESSION_IDLE_HOURS: 12,
      SESSION_MAX_DAYS: 7,
    });
  });

  it.each(['APIFY_TOKEN', 'DATABASE_URL'])('fails fast when %s is missing', (name) => {
    const source = { ...valid, [name]: undefined };
    expect(() => loadEnv(source)).toThrow(`${name} is missing`);
  });

  it('treats an empty value as missing', () => {
    expect(() => loadEnv({ ...valid, APIFY_TOKEN: '' })).toThrow('APIFY_TOKEN is missing');
  });

  it('never puts secret values in the error', () => {
    try {
      loadEnv({ ...valid, DATABASE_URL: 'not-a-url-but-secret' });
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect(String(err)).toContain('DATABASE_URL is invalid');
      expect(String(err)).not.toContain('not-a-url-but-secret');
    }
  });
});

describe('loadEnv API settings', () => {
  it('keeps paid runs off and the webhook closed by default', () => {
    const env = loadEnv(valid);
    expect(env.PAID_RUNS_ENABLED).toBe(false);
    expect(env.APIFY_WEBHOOK_SECRET).toBeUndefined();
  });

  it('turns paid runs on only for the exact value true', () => {
    expect(loadEnv({ ...valid, PAID_RUNS_ENABLED: 'true' }).PAID_RUNS_ENABLED).toBe(true);
    expect(() => loadEnv({ ...valid, PAID_RUNS_ENABLED: 'yes' })).toThrow('PAID_RUNS_ENABLED');
  });

  it('rejects a short webhook secret without echoing it', () => {
    try {
      loadEnv({ ...valid, APIFY_WEBHOOK_SECRET: 'short' });
      expect.fail('should throw');
    } catch (err) {
      expect(String(err)).toContain('APIFY_WEBHOOK_SECRET is invalid');
      expect(String(err)).not.toContain('short');
    }
  });
});
