import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';
import { explainEnvError } from './envMessage.js';

describe('explainEnvError', () => {
  it('says which setting is missing and where to add it, with no technical dump', () => {
    let error: EnvError | null = null;
    try {
      loadEnv({});
    } catch (e) {
      error = e as EnvError;
    }
    expect(error).toBeInstanceOf(EnvError);
    const text = explainEnvError(error!);
    expect(text).toContain('The server cannot start');
    expect(text).toContain('APIFY_TOKEN is missing');
    expect(text).toContain('.env');
    expect(text).not.toMatch(/ZodError|at \w+ \(/);
  });
});
