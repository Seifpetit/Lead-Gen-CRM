import { formatPhone, SECTOR_WORDING_FR, type CrmCard, type Lead } from '@lead-gen-crm/shared';

/** Who a WhatsApp message is for, from a card or a lead. */
export interface WhatsAppTarget {
  companyId: string;
  /** The decision-maker, when the message is for them; null for the company. */
  personId: string | null;
  company: string;
  /** A sector id ("olive-oil"). */
  sector: string | null;
  person: string | null;
  phone: string | null;
}

export function targetOfCard(card: CrmCard): WhatsAppTarget {
  const { company, person } = card;
  return {
    companyId: company.id,
    personId: person?.id ?? null,
    company: company.name,
    sector: company.sector,
    person: person?.fullName || null,
    phone: (person ? person.phone : null) ?? company.phone,
  };
}

export function targetOfLead(lead: Lead): WhatsAppTarget {
  const { company, contact } = lead;
  return {
    companyId: company.id,
    personId: contact?.id ?? null,
    company: company.name,
    sector: company.sector,
    person: contact?.fullName || null,
    phone: contact?.phone ?? company.phone,
  };
}

/** {sector} as it reads in a French sentence ("l'huile d'olive"). */
export const sectorWording = (sector: string | null): string | null =>
  sector ? (SECTOR_WORDING_FR[sector] ?? sector) : null;

/** The name the panel and the toast use: the person, else the company. */
export const targetName = (target: WhatsAppTarget) => target.person ?? target.company;

export const shownNumber = (target: WhatsAppTarget) => formatPhone(target.phone) ?? '';

const TEMPLATE_KEY = 'leadgen.whatsapp.template';

export function lastTemplate(): string | null {
  try {
    return window.localStorage.getItem(TEMPLATE_KEY);
  } catch {
    return null;
  }
}

export function rememberTemplate(id: string): void {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, id);
  } catch {
    // Storage blocked: the first template is picked next time.
  }
}
