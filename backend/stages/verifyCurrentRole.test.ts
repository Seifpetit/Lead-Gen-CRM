import { describe, expect, it } from 'vitest';
import type { Position } from '../providers/types.js';
import { linkedinCompanySlug, verifyCurrentRole } from './verifyCurrentRole.js';

const company = {
  name: 'Huilerie El Fixture SARL',
  linkedinUrl: 'https://www.linkedin.com/company/huilerie-el-fixture/',
};
const pos = (p: Partial<Position>): Position => ({
  title: 'Directrice Logistique',
  companyName: 'Huilerie El Fixture',
  companyLinkedinUrl: null,
  startDate: '2020',
  endDate: null,
  ...p,
});

describe('verifyCurrentRole', () => {
  it('is current for a position at the company with no end date', () => {
    const r = verifyCurrentRole([pos({})], company);
    expect(r.current).toBe(true);
    expect(r.position?.title).toBe('Directrice Logistique');
  });

  it('is never current when the position at the company has an end date', () => {
    const r = verifyCurrentRole([pos({ endDate: '2024-06' })], company);
    expect(r).toMatchObject({ current: false, reason: 'position at this company ended 2024-06' });
  });

  it('ignores an open position at another company', () => {
    const r = verifyCurrentRole(
      [pos({ companyName: 'Cartonnerie Fixture' }), pos({ endDate: '2022' })],
      company,
    );
    expect(r.current).toBe(false);
  });

  it('matches on the LinkedIn company page before the name', () => {
    const other = 'https://www.linkedin.com/company/someone-else/';
    expect(verifyCurrentRole([pos({ companyLinkedinUrl: other })], company).current).toBe(false);
    expect(
      verifyCurrentRole(
        [pos({ companyName: 'HEF Group', companyLinkedinUrl: company.linkedinUrl })],
        company,
      ).current,
    ).toBe(true);
  });

  it('does not match on a weak name fragment', () => {
    expect(
      verifyCurrentRole([pos({ companyName: 'Ste' })], { name: 'Ste Fixture', linkedinUrl: null })
        .current,
    ).toBe(false);
  });

  it('trusts the company employee list when a short profile lists no position, as an estimate', () => {
    const r = verifyCurrentRole([], company, 'company_employees');
    expect(r).toMatchObject({ current: true, position: null });
    expect(r.reason).toContain('estimate');
    // Positions at other companies are not a contradiction either.
    expect(
      verifyCurrentRole([pos({ companyName: 'Elsewhere SA' })], company, 'company_employees')
        .current,
    ).toBe(true);
  });

  it('still refuses a company-list person whose position at the company ended', () => {
    expect(
      verifyCurrentRole([pos({ endDate: '2024-06' })], company, 'company_employees').current,
    ).toBe(false);
  });

  it('stays strict for profile search results with no position at the company', () => {
    expect(verifyCurrentRole([], company, 'profile_search').current).toBe(false);
  });

  it('handles no positions', () => {
    expect(verifyCurrentRole([], company)).toMatchObject({ current: false, position: null });
  });

  it('reads company slugs', () => {
    expect(linkedinCompanySlug('https://tn.linkedin.com/company/Acme-SA/about/?x=1')).toBe(
      'acme-sa',
    );
    expect(linkedinCompanySlug('https://www.linkedin.com/in/someone')).toBeNull();
  });
});
