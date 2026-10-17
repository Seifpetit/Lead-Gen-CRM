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
