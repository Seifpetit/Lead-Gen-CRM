import type { RoleClass } from '@lead-gen-crm/shared';
import type { Sourced } from '../lib/sourced.js';
import type { EmailStatus, FoundEmail, FoundPerson } from '../providers/types.js';
import type { TitleMatch } from './matchTitle.js';
import { classifyPhone, type PhoneLine } from './normalizePhone.js';
import type { Qualification } from './qualify.js';
import type { RoleVerification } from './verifyCurrentRole.js';

export interface CompanyForLead {
  name: Sourced<string>;
  placeId: Sourced<string>;
  website: Sourced<string> | null;
  phones: Sourced<string>[];
  emails: Sourced<string>[];
  linkedinUrl: Sourced<string> | null;
  businessStatus: string | null;
  reviewsCount: number | null;
  qualification: Qualification;
}

export interface PersonForLead {
  person: FoundPerson;
  title: TitleMatch;
  role: RoleVerification;
  email: FoundEmail | null;
}

export type ChannelQuality = 'verified' | 'catch_all' | 'unverified' | 'listed';

export interface Channel {
  type: 'email' | 'phone' | 'linkedin';
  owner: 'person' | 'company';
  /** The address or number, with the source it was read from. Phones are +216 E.164. */
  value: Sourced<string>;
  quality: ChannelQuality;
  phoneLine?: PhoneLine;
  /** A phone number with a country code other than +216; flagged, never silently used. */
  foreign?: boolean;
  emailStatus?: EmailStatus;
}

export interface LeadPerson {
  fullName: Sourced<string>;
  title: Sourced<string> | null;
  roleClass: RoleClass;
  titleMatch: TitleMatch;
  linkedinUrl: Sourced<string>;
  linkedinPublicId: string | null;
  role: RoleVerification;
  email: FoundEmail | null;
}

export interface LeadCandidate {
  kind: 'person' | 'company_only';
  company: CompanyForLead;
  person: LeadPerson | null;
  /** Best channel to reach the person (or the company, for a company-only candidate). */
  channel: Channel | null;
  /** The company's own best channel, shown as the fallback. */
  companyChannel: Channel | null;
  /** People found but not used, and why. */
  skipped: { name: string; reason: string }[];
}

// Freight decisions sit with these roles first; the general manager is the last resort.
const ROLE_PRIORITY: Record<RoleClass, number> = {
  logistics: 0,
  transport: 0,
  supply_chain: 0,
  purchasing: 1,
  operations: 2,
  general_manager: 3,
};
const SENIORITY_PRIORITY = { head: 0, manager: 1, staff: 2 } as const;
const EMAIL_QUALITY: Partial<Record<EmailStatus, ChannelQuality>> = {
  valid: 'verified',
  catch_all: 'catch_all',
  unknown: 'unverified',
};
const QUALITY_RANK: Record<ChannelQuality, number> = {
  verified: 0,
  catch_all: 1,
  listed: 2,
  unverified: 3,
};

function personChannel(p: PersonForLead): Channel {
  const quality = p.email?.email ? EMAIL_QUALITY[p.email.status] : undefined;
  if (p.email?.email && quality) {
    return {
      type: 'email',
      owner: 'person',
      value: p.email.email,
      quality,
      emailStatus: p.email.status,
    };
  }
  return { type: 'linkedin', owner: 'person', value: p.person.linkedinUrl, quality: 'listed' };
}

const channelRank = (c: Channel) =>
  c.type === 'email' ? QUALITY_RANK[c.quality] : c.type === 'phone' ? 1.5 : 4;

/**
 * Company phone (Tunisian mobile before landline) first, then a website email, then a phone
 * number from another country, flagged as foreign because it is likely a head office or an
 * unrelated listing.
 */
export function bestCompanyChannel(company: CompanyForLead): Channel | null {
  const phones = company.phones
    .map((s) => ({ s, n: classifyPhone(s.value) }))
    .filter((x): x is { s: Sourced<string>; n: NonNullable<typeof x.n> } => x.n !== null)
    .filter((x) => x.n.line !== 'special');
  const local = phones
    .filter((x) => !x.n.foreign)
    .sort((a, b) => Number(a.n.line !== 'mobile') - Number(b.n.line !== 'mobile'))[0];
  if (local) {
    return {
      type: 'phone',
      owner: 'company',
      value: { ...local.s, value: local.n.e164 },
      quality: 'listed',
      ...(local.n.line ? { phoneLine: local.n.line } : {}),
    };
  }
  const email = company.emails[0];
  if (email) return { type: 'email', owner: 'company', value: email, quality: 'listed' };
  const foreign = phones.find((x) => x.n.foreign);
  if (foreign) {
    return {
      type: 'phone',
      owner: 'company',
      value: { ...foreign.s, value: foreign.n.e164 },
      quality: 'listed',
      foreign: true,
    };
  }
  return null;
}

/**
 * Picks the people worth contacting at a qualified company: a matched decision-maker role,
 * currently at the company. Ranked by channel (verified email first), role, then seniority.
 * Returns up to maxPeople person candidates, or one company-only candidate when nobody fits.
 */
export function buildLeadCandidates(
  company: CompanyForLead,
  people: readonly PersonForLead[],
  options: { maxPeople?: number } = {},
): LeadCandidate[] {
  const maxPeople = options.maxPeople ?? 1;
  const companyChannel = bestCompanyChannel(company);
  const skipped: { name: string; reason: string }[] = [];
  const eligible: (PersonForLead & { roleClass: RoleClass; channel: Channel })[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const name = p.person.fullName.value;
    const key = p.person.linkedinPublicId ?? p.person.linkedinUrl.value;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!p.title.roleClass) {
      skipped.push({ name, reason: `title not a decision-maker role (${p.title.reasons[0]})` });
    } else if (!p.role.current) {
      skipped.push({ name, reason: `not current at the company: ${p.role.reason}` });
    } else {
      eligible.push({ ...p, roleClass: p.title.roleClass, channel: personChannel(p) });
    }
  }
  eligible.sort(
    (a, b) =>
      channelRank(a.channel) - channelRank(b.channel) ||
      ROLE_PRIORITY[a.roleClass] - ROLE_PRIORITY[b.roleClass] ||
      SENIORITY_PRIORITY[a.title.seniority ?? 'staff'] -
        SENIORITY_PRIORITY[b.title.seniority ?? 'staff'] ||
      a.person.fullName.value.localeCompare(b.person.fullName.value),
  );
  if (eligible.length === 0) {
    return [
      {
        kind: 'company_only',
        company,
        person: null,
        channel: companyChannel,
        companyChannel,
        skipped,
      },
    ];
  }
  return eligible.slice(0, maxPeople).map((p) => ({
    kind: 'person',
    company,
    person: {
      fullName: p.person.fullName,
      // The position was read from the same profile as the LinkedIn URL.
      title: p.role.position
        ? { ...p.person.linkedinUrl, value: p.role.position.title }
        : p.person.headline,
      roleClass: p.roleClass,
      titleMatch: p.title,
      linkedinUrl: p.person.linkedinUrl,
      linkedinPublicId: p.person.linkedinPublicId,
      role: p.role,
      email: p.email,
    },
    channel: p.channel,
    companyChannel,
    skipped,
  }));
}
