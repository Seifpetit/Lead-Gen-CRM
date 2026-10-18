import type { RoleClass } from '@lead-gen-crm/shared';
import { withTransaction, type Queryable } from './db.js';
import { insertEvidence } from './evidence.js';
import type { UserId } from './ids.js';
import { normalizeEmail, normalizeLinkedinId } from './normalize.js';
import type { Sourced } from './sourced.js';
import { isUniqueViolation } from './companies.js';
import { assertNotSuppressed } from './suppressionList.js';

export interface ContactRecord {
  id: string;
  companyId: string;
  fullName: string;
  title: string | null;
  roleClass: RoleClass | null;
  linkedinPublicId: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  currentRoleVerified: boolean;
  /** The run that first found this person. */
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactInput {
  companyId: string;
  fullName: Sourced<string>;
  title?: Sourced<string>;
  roleClass?: Sourced<RoleClass>;
  linkedinPublicId?: Sourced<string>;
  linkedinUrl?: Sourced<string>;
  email?: Sourced<string>;
  phone?: Sourced<string>;
  currentRoleVerified?: Sourced<boolean>;
}

export class UnknownCompanyError extends Error {
  constructor() {
    super('Company not found for this user');
    this.name = 'UnknownCompanyError';
  }
}

interface Row {
  id: string;
  company_id: string;
  full_name: string;
  title: string | null;
  role_class: RoleClass | null;
  linkedin_public_id: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  current_role_verified: boolean;
  run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const toContact = (r: Row): ContactRecord => ({
  id: r.id,
  companyId: r.company_id,
  fullName: r.full_name,
  title: r.title,
  roleClass: r.role_class,
  linkedinPublicId: r.linkedin_public_id,
  linkedinUrl: r.linkedin_url,
  email: r.email,
  phone: r.phone,
  currentRoleVerified: r.current_role_verified,
  runId: r.run_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Inserts or merges a person (dedupe on LinkedIn public ID) and records evidence for every
 * value given. Refuses the write with SuppressedContactError when any identifier, new or
 * already stored, is on the suppression list.
 */
export async function upsertContact(
  db: Queryable,
  userId: UserId,
  input: ContactInput,
  runId: string | null = null,
): Promise<{ contact: ContactRecord; created: boolean }> {
  return withTransaction(db, async (tx) => {
    const company = await tx.query('SELECT 1 FROM companies WHERE user_id = $1 AND id = $2', [
      userId,
      input.companyId,
    ]);
    if (company.rowCount === 0) throw new UnknownCompanyError();

    const linkedinId = input.linkedinPublicId
      ? normalizeLinkedinId(input.linkedinPublicId.value)
      : null;
    const findExisting = async () =>
      linkedinId
        ? (
            await tx.query<Row>(
              'SELECT * FROM contacts WHERE user_id = $1 AND linkedin_public_id = $2 FOR UPDATE',
              [userId, linkedinId],
            )
          ).rows[0]
        : undefined;
    let existing = await findExisting();

    const values = {
      full_name: input.fullName.value.trim(),
      title: input.title?.value.trim() ?? null,
      role_class: input.roleClass?.value ?? null,
      linkedin_url: input.linkedinUrl?.value.trim() ?? null,
      email: input.email ? normalizeEmail(input.email.value) : null,
      phone: input.phone?.value.trim() ?? null,
      current_role_verified: input.currentRoleVerified?.value ?? null,
    };

    await assertNotSuppressed(tx, {
      email: values.email ?? existing?.email ?? null,
      phone: values.phone ?? existing?.phone ?? null,
      linkedinPublicId: linkedinId,
    });

    let row: Row | undefined;
    if (!existing) {
      // A concurrent run may insert the same LinkedIn ID first: merge into it instead.
      await tx.query('SAVEPOINT upsert_contact');
      try {
        row = await insertContact();
        await tx.query('RELEASE SAVEPOINT upsert_contact');
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await tx.query('ROLLBACK TO SAVEPOINT upsert_contact');
        existing = await findExisting();
        if (!existing) throw err;
      }
    }
    async function insertContact(): Promise<Row> {
      const { rows } = await tx.query<Row>(
        `INSERT INTO contacts (user_id, company_id, full_name, title, role_class, linkedin_public_id,
                               linkedin_url, email, phone, current_role_verified, run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, false), $11) RETURNING *`,
        [
          userId,
          input.companyId,
          values.full_name,
          values.title,
          values.role_class,
          linkedinId,
          values.linkedin_url,
          values.email,
          values.phone,
          values.current_role_verified,
          runId,
        ],
      );
      return rows[0]!;
    }
    if (!row) {
      const { rows } = await tx.query<Row>(
        `UPDATE contacts SET
           company_id = $3, full_name = $4, title = COALESCE($5, title),
           role_class = COALESCE($6, role_class), linkedin_url = COALESCE($7, linkedin_url),
           email = COALESCE($8, email), phone = COALESCE($9, phone),
           current_role_verified = COALESCE($10, current_role_verified),
           run_id = COALESCE(run_id, $11), updated_at = now()
         WHERE user_id = $1 AND id = $2 RETURNING *`,
        [
          userId,
          existing!.id,
          input.companyId,
          values.full_name,
          values.title,
          values.role_class,
          values.linkedin_url,
          values.email,
          values.phone,
          values.current_role_verified,
          runId,
        ],
      );
      row = rows[0]!;
    }

    const target = { contactId: row.id };
    const created = row.id !== existing?.id;
    for (const [field, sourced] of Object.entries(input)) {
      if (field === 'companyId' || sourced === undefined) continue;
      await insertEvidence(tx, userId, target, field, sourced as Sourced<unknown>, runId);
    }
    return { contact: toContact(row), created };
  });
}

export async function getContact(
  db: Queryable,
  userId: UserId,
  contactId: string,
): Promise<ContactRecord | null> {
  const { rows } = await db.query<Row>('SELECT * FROM contacts WHERE user_id = $1 AND id = $2', [
    userId,
    contactId,
  ]);
  return rows[0] ? toContact(rows[0]) : null;
}

export async function listContactsForCompany(
  db: Queryable,
  userId: UserId,
  companyId: string,
): Promise<ContactRecord[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM contacts WHERE user_id = $1 AND company_id = $2 ORDER BY full_name',
    [userId, companyId],
  );
  return rows.map(toContact);
}

/**
 * Companies in a region whose newest contact was last updated before `olderThan`: the
 * maintenance run re-checks these people.
 */
export async function listCompaniesWithStaleContacts(
  db: Queryable,
  userId: UserId,
  regionId: string,
  olderThan: Date,
): Promise<string[]> {
  const { rows } = await db.query<{ company_id: string }>(
    `SELECT p.company_id FROM contacts p JOIN companies c ON c.id = p.company_id
      WHERE p.user_id = $1 AND c.governorate = $2
      GROUP BY p.company_id HAVING max(p.updated_at) < $3
      ORDER BY p.company_id`,
    [userId, regionId, olderThan],
  );
  return rows.map((r) => r.company_id);
}

/**
 * Sets a contact's email (with its evidence), after the suppression check. Throws
 * SuppressedContactError when the address or the person is suppressed.
 */
export async function setContactEmail(
  db: Queryable,
  userId: UserId,
  contactId: string,
  email: Sourced<string>,
  runId: string | null,
): Promise<ContactRecord | null> {
  return withTransaction(db, async (tx) => {
    const { rows: found } = await tx.query<Row>(
      'SELECT * FROM contacts WHERE user_id = $1 AND id = $2 FOR UPDATE',
      [userId, contactId],
    );
    const existing = found[0];
    if (!existing) return null;
    const value = normalizeEmail(email.value);
    await assertNotSuppressed(tx, {
      email: value,
      phone: existing.phone,
      linkedinPublicId: existing.linkedin_public_id,
    });
    const { rows } = await tx.query<Row>(
      'UPDATE contacts SET email = $3, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *',
      [userId, contactId, value],
    );
    await insertEvidence(tx, userId, { contactId }, 'email', email, runId);
    return toContact(rows[0]!);
  });
}
