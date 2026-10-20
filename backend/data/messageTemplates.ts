import {
  DEFAULT_TEMPLATES,
  MAX_TEMPLATES,
  type MessageTemplate,
  type MessageTemplateInput,
  type SenderProfile,
} from '@lead-gen-crm/shared';
import { withTransaction, type Db, type Queryable } from './db.js';
import type { UserId } from './ids.js';

// A user's message templates and who the messages come from. Templates are per user; a user
// who has never opened them gets the three French defaults once.

interface TemplateRow {
  id: string;
  name: string;
  body: string;
  updated_at: Date;
}

const toTemplate = (r: TemplateRow): MessageTemplate => ({
  id: r.id,
  name: r.name,
  body: r.body,
  updatedAt: r.updated_at.toISOString(),
});

export class TemplateLimitError extends Error {
  constructor() {
    super(`A user keeps at most ${MAX_TEMPLATES} templates`);
    this.name = 'TemplateLimitError';
  }
}

/** The user's templates in their order, writing the defaults first if they never had any. */
export async function listTemplates(db: Db, userId: UserId): Promise<MessageTemplate[]> {
  return withTransaction(db, async (tx) => {
    const seeded = await tx.query<{ templates_seeded: boolean }>(
      'SELECT templates_seeded FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (seeded.rows[0] && !seeded.rows[0].templates_seeded) {
      for (const [i, t] of DEFAULT_TEMPLATES.entries()) {
        await tx.query(
          'INSERT INTO message_templates (user_id, name, body, position) VALUES ($1, $2, $3, $4)',
          [userId, t.name, t.body, i],
        );
      }
      await tx.query('UPDATE users SET templates_seeded = true WHERE id = $1', [userId]);
    }
    const { rows } = await tx.query<TemplateRow>(
      `SELECT id, name, body, updated_at FROM message_templates
        WHERE user_id = $1 ORDER BY position, created_at, id`,
      [userId],
    );
    return rows.map(toTemplate);
  });
}

export async function createTemplate(
  db: Db,
  userId: UserId,
  input: MessageTemplateInput,
): Promise<MessageTemplate> {
  return withTransaction(db, async (tx) => {
    // Lock the user so two creations at once cannot both pass the limit.
    await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const count = await tx.query<{ n: number; next: number }>(
      `SELECT count(*)::integer AS n, coalesce(max(position) + 1, 0)::integer AS next
         FROM message_templates WHERE user_id = $1`,
      [userId],
    );
    const { n, next } = count.rows[0]!;
    if (n >= MAX_TEMPLATES) throw new TemplateLimitError();
    const { rows } = await tx.query<TemplateRow>(
      `INSERT INTO message_templates (user_id, name, body, position) VALUES ($1, $2, $3, $4)
       RETURNING id, name, body, updated_at`,
      [userId, input.name, input.body, next],
    );
    // A user who writes their own first never gets the defaults on top.
    await tx.query('UPDATE users SET templates_seeded = true WHERE id = $1', [userId]);
    return toTemplate(rows[0]!);
  });
}

/** Null when the template is not this user's. */
export async function updateTemplate(
  db: Queryable,
  userId: UserId,
  id: string,
  input: MessageTemplateInput,
): Promise<MessageTemplate | null> {
  const { rows } = await db.query<TemplateRow>(
    `UPDATE message_templates SET name = $3, body = $4, updated_at = now()
      WHERE user_id = $1 AND id = $2 RETURNING id, name, body, updated_at`,
    [userId, id, input.name, input.body],
  );
  return rows[0] ? toTemplate(rows[0]) : null;
}

/** False when the template is not this user's. */
export async function deleteTemplate(db: Queryable, userId: UserId, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM message_templates WHERE user_id = $1 AND id = $2',
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function getSenderProfile(db: Queryable, userId: UserId): Promise<SenderProfile> {
  const { rows } = await db.query<{ sender_name: string; sender_company: string }>(
    'SELECT sender_name, sender_company FROM users WHERE id = $1',
    [userId],
  );
  return { name: rows[0]?.sender_name ?? '', company: rows[0]?.sender_company ?? '' };
}

export async function setSenderProfile(
  db: Queryable,
  userId: UserId,
  profile: SenderProfile,
): Promise<SenderProfile> {
  const { rows } = await db.query<{ sender_name: string; sender_company: string }>(
    `UPDATE users SET sender_name = $2, sender_company = $3 WHERE id = $1
     RETURNING sender_name, sender_company`,
    [userId, profile.name, profile.company],
  );
  return { name: rows[0]?.sender_name ?? '', company: rows[0]?.sender_company ?? '' };
}
