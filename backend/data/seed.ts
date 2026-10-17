import { TUNISIAN_GOVERNORATES } from '../config/regions.js';
import { upsertCompany } from './companies.js';
import { upsertContact } from './contacts.js';
import { upsertLead } from './crmLeads.js';
import type { Queryable } from './db.js';
import { upsertRegions } from './regions.js';
import { createRun } from './runs.js';
import type { Sourced } from './sourced.js';
import { createUser, findUserByEmail } from './users.js';

/** Reference data every environment needs: the region list. Safe to run repeatedly. */
export async function seedReference(db: Queryable): Promise<void> {
  await upsertRegions(db, TUNISIAN_GOVERNORATES);
}

export const DEMO_EMAIL = 'demo@example.com';

/**
 * Local development data only. Every value is an obvious placeholder on reserved
 * example domains, so it can never be mistaken for (or contacted as) a real lead.
 */
export async function seedDemo(db: Queryable): Promise<void> {
  if (await findUserByEmail(db, DEMO_EMAIL)) return;
  // Not a usable hash: the demo user cannot sign in until auth (pass 2) sets a password.
  const user = await createUser(db, { email: DEMO_EMAIL, passwordHash: '!demo-no-login' });
  const at = new Date('2026-01-01T00:00:00Z');
  const src = <T>(value: T, kind: 'fact' | 'estimate' = 'fact'): Sourced<T> => ({
    value,
    sourceUrl: 'https://example.com/demo-source',
    fetchedAt: at,
    kind,
  });

  const run = await createRun(db, user.id, { regionId: 'sfax', spendCapUsd: 10 });
  const { company } = await upsertCompany(db, user.id, {
    name: src('Demo Logistics Company SARL'),
    governorate: src('sfax'),
    website: src('https://demo-company.example.com'),
    phone: src('+216 00 000 000'),
    sector: src('agri-food', 'estimate'),
  });
  const { contact } = await upsertContact(db, user.id, {
    companyId: company.id,
    fullName: src('Demo Contact'),
    title: src('Responsable Logistique'),
    roleClass: src('logistics', 'estimate'),
    linkedinPublicId: src('demo-contact-example'),
    email: src('contact@demo-company.example.com', 'estimate'),
  });
  await upsertLead(db, user.id, {
    runId: run.id,
    companyId: company.id,
    contactId: contact.id,
    score: { companyFit: 40, contactFit: 25, reachability: 10 },
  });
}
