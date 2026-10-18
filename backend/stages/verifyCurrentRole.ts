import { normalizeCompanyName } from '../lib/normalize.js';
import type { Position } from '../providers/types.js';

export interface CompanyIdentity {
  name: string;
  linkedinUrl: string | null;
}

export interface RoleVerification {
  /** True only for a position at this company with no end date. */
  current: boolean;
  position: Position | null;
  reason: string;
}

/** "https://www.linkedin.com/company/acme-sa/about/" -> "acme-sa". */
export function linkedinCompanySlug(url: string | null): string | null {
  if (!url) return null;
  const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(url);
  return m ? decodeURIComponent(m[1]!).toLowerCase() : null;
}

function sameCompany(position: Position, company: CompanyIdentity): boolean {
  const a = linkedinCompanySlug(position.companyLinkedinUrl);
  const b = linkedinCompanySlug(company.linkedinUrl);
  if (a && b) return a === b;
  const p = normalizeCompanyName(position.companyName);
  const c = normalizeCompanyName(company.name);
  if (p === '' || c === '') return false;
  if (p === c) return true;
  // "Poulina Group Holding" vs "Poulina": the shorter name must be two or more words, or a
  // single word of 5+ letters, to avoid matching on "Ste" or "Tunisie".
  const [short, long] = p.length <= c.length ? [p, c] : [c, p];
  const shortTokens = short.split(' ');
  const strongEnough = shortTokens.length >= 2 || short.length >= 5;
  return strongEnough && ` ${long} `.includes(` ${short} `);
}

const hasEnded = (p: Position) => p.endDate !== null && p.endDate.trim() !== '';

/**
 * A person is current at the company when one of their positions there has no end date.
 * A position with an end date is never current, even if it is the only one listed.
 */
export function verifyCurrentRole(
  positions: readonly Position[],
  company: CompanyIdentity,
  via?: 'company_employees' | 'profile_search',
): RoleVerification {
  const atCompany = positions.filter((p) => sameCompany(p, company));
  if (atCompany.length === 0) {
    // The company-employees list is the company's own current staff, and short profiles in it
    // often carry no experience entries. Without a contradicting position, trust the list,
    // but as an estimate in the reason rather than a verified fact.
    if (via === 'company_employees') {
      return {
        current: true,
        position: null,
        reason: 'listed as an employee of this company (no position data to check; estimate)',
      };
    }
    return { current: false, position: null, reason: 'no listed position at this company' };
  }
  const open = atCompany.find((p) => !hasEnded(p));
  if (open) {
    return { current: true, position: open, reason: `"${open.title}" has no end date` };
  }
  const last = atCompany[0]!;
  return {
    current: false,
    position: last,
    reason: `position at this company ended ${last.endDate}`,
  };
}
