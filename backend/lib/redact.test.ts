import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('hides known secrets wherever they appear', () => {
    const token = 'my-very-private-value-123';
    expect(redactSecrets(`calling with ${token} and again ${token}`, [token])).toBe(
      'calling with [hidden] and again [hidden]',
    );
  });

  it('ignores empty and very short secrets instead of mangling ordinary words', () => {
    expect(redactSecrets('the run ran fine', ['', null, undefined, 'run'])).toBe(
      'the run ran fine',
    );
  });

  it.each([
    ['Apify token apify_api_AbCdEf123456 rejected', 'apify_api_AbCdEf123456'],
    ['key sk-ant-api03-abcdefghijklmnop failed', 'sk-ant-api03-abcdefghijklmnop'],
    ['header Authorization: Bearer abcDEF123456.xyz', 'abcDEF123456.xyz'],
    ['GET https://api.apify.com/v2/runs?token=abcdef123456&x=1', 'abcdef123456'],
    ['{"apiKey": "super-secret-key"}', 'super-secret-key'],
    ['password=hunter2hunter2', 'hunter2hunter2'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH', 'eyJhbGciOiJIUzI1NiJ9'],
  ])('hides anything shaped like a credential: %s', (text, secret) => {
    const out = redactSecrets(text);
    expect(out).not.toContain(secret);
    expect(out).toContain('[hidden]');
  });

  it('keeps ordinary text, numbers and URLs', () => {
    const text = 'Search "huilerie" in area 2: 20 places returned (https://maps.example/place/9)';
    expect(redactSecrets(text)).toBe(text);
  });
});
