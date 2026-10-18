import { describe, expect, it } from 'vitest';
import { EnvError, loadDevAdminLogin, loadEnv } from './env.js';

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
      HOST: '127.0.0.1',
      DEV_ADMIN_LOGIN: false,
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

describe('DEV_ADMIN_LOGIN guards', () => {
  const dev = { ...valid, DEV_ADMIN_LOGIN: 'true' };

  it('starts on a loopback host in development, with a localhost PUBLIC_URL, or on ::1', () => {
    expect(loadEnv(dev).DEV_ADMIN_LOGIN).toBe(true);
    expect(loadEnv({ ...dev, PUBLIC_URL: 'http://localhost:3000' }).DEV_ADMIN_LOGIN).toBe(true);
    expect(loadEnv({ ...dev, HOST: '::1' }).DEV_ADMIN_LOGIN).toBe(true);
  });

  it.each([
    ['NODE_ENV is production', { NODE_ENV: 'production' }],
    ['HOST is not a loopback address', { HOST: '0.0.0.0' }],
    ['PUBLIC_URL is not a localhost URL', { PUBLIC_URL: 'https://app.example.com' }],
  ])('refuses to start when %s', (message, extra) => {
    expect(() => loadEnv({ ...dev, ...extra })).toThrow(message);
  });

  it('does not restrict anything while the flag is off', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'production', HOST: '0.0.0.0' }).DEV_ADMIN_LOGIN).toBe(
      false,
    );
  });

  it('applies the same guards to the admin CLI', () => {
    expect(loadDevAdminLogin({ DEV_ADMIN_LOGIN: 'true' })).toBe(true);
    expect(loadDevAdminLogin({})).toBe(false);
    expect(() => loadDevAdminLogin({ DEV_ADMIN_LOGIN: 'true', NODE_ENV: 'production' })).toThrow(
      'NODE_ENV is production',
    );
  });
});
