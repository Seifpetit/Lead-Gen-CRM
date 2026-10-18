import { describe, expect, it } from 'vitest';
import { FIXED_NOW } from '../test/fixtures.js';
import { bestCompanyChannel, type CompanyForLead } from './buildLeadCandidate.js';

const s = (value: string) => ({
  value,
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:x',
  fetchedAt: FIXED_NOW,
  kind: 'fact' as const,
});
const company = (phones: string[], emails: string[] = []) =>
  ({
    name: s('Fixture'),
    placeId: s('x'),
    website: null,
    phones: phones.map(s),
    emails: emails.map(s),
    linkedinUrl: null,
    businessStatus: 'OPERATIONAL',
    reviewsCount: null,
    qualification: {} as CompanyForLead['qualification'],
  }) satisfies CompanyForLead;

describe('bestCompanyChannel', () => {
  it('normalizes a Tunisian number to +216, mobile before landline', () => {
    expect(bestCompanyChannel(company(['74 123 456', '98 123 456']))).toMatchObject({
      type: 'phone',
      value: { value: '+21698123456' },
      phoneLine: 'mobile',
    });
  });

  it('flags a number from another country, and only uses it when nothing else is left', () => {
    const foreignOnly = bestCompanyChannel(company(['+33 1 23 45 67 89']));
    expect(foreignOnly).toMatchObject({
      type: 'phone',
      foreign: true,
      value: { value: '+33123456789' },
    });
    // A Tunisian number or an email is preferred to a foreign number.
    expect(bestCompanyChannel(company(['+33 1 23 45 67 89', '74 123 456']))).toMatchObject({
      value: { value: '+21674123456' },
    });
    const withEmail = bestCompanyChannel(company(['+33 1 23 45 67 89'], ['a@x.tn']));
    expect(withEmail).toMatchObject({ type: 'email' });
    expect(withEmail).not.toHaveProperty('foreign');
  });

  it('has no channel when the numbers are unusable', () => {
    expect(bestCompanyChannel(company(['n/a', '123']))).toBeNull();
  });
});
