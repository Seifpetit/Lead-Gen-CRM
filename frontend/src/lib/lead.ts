import type { Company, Contact, Evidence } from '@lead-gen-crm/shared';
import { evidenceFor } from './format.js';

export type ChannelKind = 'email' | 'phone' | 'linkedin';

export interface Channel {
  kind: ChannelKind;
  value: string;
  evidence: Evidence | null;
}

/**
 * The person's best way to be reached: email first, then phone, then their LinkedIn profile.
 * Only values that exist are offered; nothing is made up to fill a gap.
 */
export function bestChannel(contact: Contact | null): Channel | null {
  if (!contact) return null;
  if (contact.email) {
    return {
      kind: 'email',
      value: contact.email,
      evidence: evidenceFor(contact.evidence, 'email', contact.email),
    };
  }
  if (contact.phone) {
    return {
      kind: 'phone',
      value: contact.phone,
      evidence: evidenceFor(contact.evidence, 'phone', contact.phone),
    };
  }
  if (contact.linkedinUrl) {
    return {
      kind: 'linkedin',
      value: contact.linkedinUrl,
      evidence: evidenceFor(contact.evidence, 'linkedinUrl', contact.linkedinUrl),
    };
  }
  return null;
}

/** The company's own channels, used only when the person has none. */
export function companyChannels(company: Company): Channel[] {
  const out: Channel[] = [];
  if (company.phone)
    out.push({
      kind: 'phone',
      value: company.phone,
      evidence: evidenceFor(company.evidence, 'phone', company.phone),
    });
  if (company.email)
    out.push({
      kind: 'email',
      value: company.email,
      evidence: evidenceFor(company.evidence, 'email', company.email),
    });
  return out;
}

/** A link for a channel value, or null when it is not safe to link. */
export function channelHref(channel: Channel): string | null {
  if (channel.kind === 'email')
    return /^[^\s@]+@[^\s@]+$/.test(channel.value) ? `mailto:${channel.value}` : null;
  if (channel.kind === 'phone')
    return /^\+?[\d\s().-]+$/.test(channel.value)
      ? `tel:${channel.value.replace(/[\s().-]/g, '')}`
      : null;
  return null;
}
