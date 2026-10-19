import {
  BOARD_STAGES,
  type AddDecisionMakerResult,
  type BoardStage,
  type BoardStageKey,
  type CrmBoard,
  type CrmCard,
  type CrmPipeline,
  type RoleClass,
} from '@lead-gen-crm/shared';
import { withTransaction, type Queryable } from './db.js';
import type { UserId } from './ids.js';
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizeLinkedinId,
  phoneKey,
} from './normalize.js';
import type { Sourced } from './sourced.js';
import { upsertContact } from './contacts.js';
import {
  addSuppression,
  findSuppressed,
  SuppressedContactError,
  type SuppressionKind,
} from './suppressionList.js';

// The two CRM boards: a card per company and a card per decision-maker. The stage of a card
// lives here (crm_cards); crm_leads keeps the scored lead and only mirrors the two things the
// rest of the system reads from it: dismissed (scoring feedback) and opted_out (suppression).

export type BoardErrorCode =
  | 'not_found'
  | 'invalid_stage'
  | 'decision_maker_required'
  | 'invalid_decision_maker'
  | 'reason_required'
  | 'opted_out_is_final'
  | 'in_noise'
  | 'not_in_noise'
  | 'suppressed';

/** A refused board action; the route turns the code into an HTTP status. */
export class BoardError extends Error {
  constructor(
    public readonly code: BoardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}

// ---------------------------------------------------------------------------------------
// Reading

interface CardRow {
  id: string;
  pipeline: CrmPipeline;
  stage: BoardStageKey;
  stage_entered_at: Date;
  noise_at: Date | null;
  noise_from_stage: BoardStageKey | null;
  company_id: string;
  contact_id: string | null;
  company_name: string;
  sector: string | null;
  website: string | null;
  company_phone: string | null;
  company_email: string | null;
  full_name: string | null;
  title: string | null;
  person_email: string | null;
  person_phone: string | null;
  linkedin_url: string | null;
  score: number | null;
}

const CARD_SELECT = `
  SELECT k.id, k.pipeline, k.stage, k.stage_entered_at, k.noise_at, k.noise_from_stage,
         k.company_id, k.contact_id,
         c.name AS company_name, c.sector, c.website, c.phone AS company_phone, c.email AS company_email,
         p.full_name, p.title, p.email AS person_email, p.phone AS person_phone, p.linkedin_url,
         (SELECT max(l.score_total)::integer FROM crm_leads l
           WHERE l.user_id = k.user_id AND l.company_id = k.company_id
             AND (k.contact_id IS NULL OR l.contact_id = k.contact_id)) AS score
    FROM crm_cards k
    JOIN companies c ON c.id = k.company_id
    LEFT JOIN contacts p ON p.id = k.contact_id`;

const DAY_MS = 86_400_000;

function toCard(r: CardRow, retentionDays: number): CrmCard {
  return {
    id: r.id,
    pipeline: r.pipeline,
    stage: r.stage,
    stageEnteredAt: r.stage_entered_at.toISOString(),
    noiseAt: r.noise_at?.toISOString() ?? null,
    purgeAt: r.noise_at
      ? new Date(r.noise_at.getTime() + retentionDays * DAY_MS).toISOString()
      : null,
    removedFrom: r.noise_from_stage,
    company: {
      id: r.company_id,
      name: r.company_name,
      sector: r.sector,
      website: r.website,
      phone: r.company_phone,
      email: r.company_email,
    },
    person: r.contact_id
      ? {
          id: r.contact_id,
          fullName: r.full_name ?? '',
          title: r.title,
          email: r.person_email,
          phone: r.person_phone,
          linkedinUrl: r.linkedin_url,
        }
      : null,
    score: r.score,
  };
}

export async function listStages(db: Queryable, pipeline: CrmPipeline): Promise<BoardStage[]> {
  const { rows } = await db.query<{ key: BoardStageKey; name: string; collapsed: boolean }>(
    `SELECT key, name, collapsed_by_default AS collapsed FROM pipeline_stages
      WHERE pipeline = $1 ORDER BY position`,
    [pipeline],
  );
  return rows.map((r) => ({ key: r.key, name: r.name, collapsedByDefault: r.collapsed }));
}

/** A whole board: its columns and every card, best score first. */
export async function loadBoard(
  db: Queryable,
  userId: UserId,
  pipeline: CrmPipeline,
  retentionDays: number,
): Promise<CrmBoard> {
  const { rows } = await db.query<CardRow>(
    `${CARD_SELECT} WHERE k.user_id = $1 AND k.pipeline = $2
      ORDER BY score DESC NULLS LAST, k.created_at, k.id`,
    [userId, pipeline],
  );
  return {
    pipeline,
    stages: await listStages(db, pipeline),
    cards: rows.map((r) => toCard(r, retentionDays)),
  };
}

export async function getCard(
  db: Queryable,
  userId: UserId,
  cardId: string,
  retentionDays: number,
): Promise<CrmCard | null> {
  const { rows } = await db.query<CardRow>(`${CARD_SELECT} WHERE k.user_id = $1 AND k.id = $2`, [
    userId,
    cardId,
  ]);
  return rows[0] ? toCard(rows[0], retentionDays) : null;
}

// ---------------------------------------------------------------------------------------
// Moving, removing, restoring

interface LockedCard {
  id: string;
  pipeline: CrmPipeline;
  stage: BoardStageKey;
  noise_from_stage: BoardStageKey | null;
  company_id: string;
  contact_id: string | null;
}

async function lockCard(db: Queryable, userId: UserId, cardId: string): Promise<LockedCard> {
  const { rows } = await db.query<LockedCard>(
    `SELECT id, pipeline, stage, noise_from_stage, company_id, contact_id
       FROM crm_cards WHERE user_id = $1 AND id = $2 FOR UPDATE`,
    [userId, cardId],
  );
  if (!rows[0]) throw new BoardError('not_found', 'Card not found');
  return rows[0];
}

/** The leads a card stands for: the company's leads, or the leads with this person. */
const CARD_LEADS = `user_id = $1 AND company_id = $2 AND ($3::uuid IS NULL OR contact_id = $3)`;

async function setStage(db: Queryable, card: LockedCard, stage: BoardStageKey): Promise<void> {
  await db.query(
    `UPDATE crm_cards SET stage = $2, stage_entered_at = now(), updated_at = now(),
            noise_at = NULL, noise_from_stage = NULL
      WHERE id = $1 AND stage <> $2`,
    [card.id, stage],
  );
}

async function sendToNoise(db: Queryable, userId: UserId, card: LockedCard): Promise<void> {
  if (card.stage === 'opted_out') {
    throw new BoardError(
      'opted_out_is_final',
      'An objection cannot be undone: it stays on the board',
    );
  }
  if (card.stage === 'noise') return;
  await db.query(
    `UPDATE crm_cards SET stage = 'noise', noise_at = now(), noise_from_stage = $2,
            stage_entered_at = now(), updated_at = now() WHERE id = $1`,
    [card.id, card.stage],
  );
  // The existing dismissal feedback: scoring reads leads in 'dismissed'. Opted out stays opted out.
  await db.query(
    `UPDATE crm_leads SET stage = 'dismissed', stage_changed_at = now(), updated_at = now()
      WHERE ${CARD_LEADS} AND stage NOT IN ('dismissed', 'opted_out')`,
    [userId, card.company_id, card.contact_id],
  );
}

async function leaveNoise(
  db: Queryable,
  userId: UserId,
  card: LockedCard,
  to: BoardStageKey,
): Promise<void> {
  await setStage(db, card, to);
  await db.query(
    `UPDATE crm_leads SET stage = 'system_suggested', stage_changed_at = now(), updated_at = now()
      WHERE ${CARD_LEADS} AND stage = 'dismissed'`,
    [userId, card.company_id, card.contact_id],
  );
}

/**
 * An objection from a person card: every identifier we hold for the person goes on the
 * suppression list (which every later write checks), their leads become opted out and the card
 * moves to Opted out, where it stays for good.
 */
async function recordPersonObjection(
  db: Queryable,
  userId: UserId,
  card: LockedCard,
  reason: string,
): Promise<SuppressionKind[]> {
  const { rows } = await db.query<{
    email: string | null;
    phone: string | null;
    linkedin_public_id: string | null;
  }>('SELECT email, phone, linkedin_public_id FROM contacts WHERE user_id = $1 AND id = $2', [
    userId,
    card.contact_id,
  ]);
  const p = rows[0];
  if (!p) throw new BoardError('not_found', 'Person not found');
  const suppressed: SuppressionKind[] = [];
  for (const [kind, value] of [
    ['email', p.email],
    ['phone', p.phone],
    ['linkedin', p.linkedin_public_id],
  ] as const) {
    if (!value) continue;
    await addSuppression(db, userId, { kind, value, reason });
    suppressed.push(kind);
  }
  await db.query(
    `UPDATE crm_leads SET stage = 'opted_out', stage_changed_at = now(), updated_at = now()
      WHERE ${CARD_LEADS}`,
    [userId, card.company_id, card.contact_id],
  );
  await setStage(db, card, 'opted_out');
  return suppressed;
}

/**
 * Moves a card to a column. Rules:
 * - Companies: Decision-maker identified is only reached by adding a decision-maker
 *   (addDecisionMaker), unless the company already has a live person card.
 * - People: Opted out needs a reason and is final. Opted out cards cannot be removed.
 * - Noise: moving in is a removal (it feeds scoring); moving out is a restore.
 */
export async function moveCard(
  db: Queryable,
  userId: UserId,
  cardId: string,
  to: string,
  opts: { reason?: string | undefined } = {},
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const card = await lockCard(tx, userId, cardId);
    if (!(BOARD_STAGES[card.pipeline] as readonly string[]).includes(to)) {
      throw new BoardError('invalid_stage', `${to} is not a column of the ${card.pipeline} board`);
    }
    const target = to as BoardStageKey;
    if (card.stage === target) return;
    if (card.stage === 'opted_out') {
      throw new BoardError('opted_out_is_final', 'An objection cannot be undone from the CRM');
    }
    if (target === 'noise') return sendToNoise(tx, userId, card);

    if (card.pipeline === 'companies' && target === 'decision_maker_identified') {
      const { rows } = await tx.query(
        `SELECT 1 FROM crm_cards WHERE user_id = $1 AND pipeline = 'people' AND company_id = $2
            AND stage <> 'noise' LIMIT 1`,
        [userId, card.company_id],
      );
      if (rows.length === 0) {
        throw new BoardError(
          'decision_maker_required',
          'Add the decision-maker to move this company to Decision-maker identified',
        );
      }
    }
    if (card.pipeline === 'people' && target === 'opted_out') {
      if (!opts.reason) {
        throw new BoardError('reason_required', 'Opting out records an objection: give a reason');
      }
      if (card.stage === 'noise')
        await leaveNoise(tx, userId, card, card.noise_from_stage ?? 'new');
      await recordPersonObjection(tx, userId, card, opts.reason);
      return;
    }
    if (card.stage === 'noise') await leaveNoise(tx, userId, card, target);
    else await setStage(tx, card, target);
  });
}

/** Removes a card: it moves to Noise and its leads count as dismissed for scoring. */
export async function removeCard(db: Queryable, userId: UserId, cardId: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await sendToNoise(tx, userId, await lockCard(tx, userId, cardId));
  });
}

/** Restores a Noise card to the column it was removed from (or `to`). */
export async function restoreCard(
  db: Queryable,
  userId: UserId,
  cardId: string,
  to?: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const card = await lockCard(tx, userId, cardId);
    if (card.stage !== 'noise')
      throw new BoardError('not_in_noise', 'Only a card in Noise can be restored');
    const target = to ?? card.noise_from_stage ?? BOARD_STAGES[card.pipeline][0];
    if (
      target === 'noise' ||
      target === 'opted_out' ||
      !(BOARD_STAGES[card.pipeline] as readonly string[]).includes(target)
    ) {
      throw new BoardError('invalid_stage', `Cannot restore into ${target}`);
    }
    if (card.pipeline === 'companies' && target === 'decision_maker_identified') {
      throw new BoardError('decision_maker_required', 'Restore into Found or Investigating');
    }
    await leaveNoise(tx, userId, card, target as BoardStageKey);
  });
}

// ---------------------------------------------------------------------------------------
// Adding a decision-maker

export interface DecisionMaker {
  fullName: string;
  title?: string | undefined;
  roleClass?: RoleClass | null | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  linkedinUrl?: string | undefined;
}

/** Entered by the user, not read from a page: the evidence says so with an address that never resolves. */
const ENTERED_BY_USER = 'https://lead-gen-crm.invalid/entered-by-user';

/** The profile ID in a linkedin.com/in/<id> address, or null for any other address. */
export function linkedinIdFromUrl(url: string): string | null {
  try {
    const m = /^\/in\/([^/?#]+)/i.exec(new URL(url).pathname);
    return m?.[1] ? normalizeLinkedinId(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Names the decision-maker of a company card. One transaction: the person is stored (and
 * refused when on the suppression list), a person card starts in New, and the company card
 * moves to Decision-maker identified. A name and at least one channel are required.
 */
export async function addDecisionMaker(
  db: Queryable,
  userId: UserId,
  companyCardId: string,
  input: DecisionMaker,
  retentionDays: number,
): Promise<AddDecisionMakerResult> {
  const fullName = input.fullName.trim();
  const channels = [input.email, input.phone, input.linkedinUrl].filter((v) => v && v.trim());
  if (!fullName || channels.length === 0) {
    throw new BoardError(
      'invalid_decision_maker',
      'A name and at least one of email, phone or LinkedIn are required',
    );
  }
  return withTransaction(db, async (tx) => {
    const card = await lockCard(tx, userId, companyCardId);
    if (card.pipeline !== 'companies') {
      throw new BoardError('invalid_stage', 'A decision-maker is added to a company card');
    }
    if (card.stage === 'noise')
      throw new BoardError('in_noise', 'Restore the company before adding a decision-maker');

    const src = <T>(value: T): Sourced<T> => ({
      value,
      sourceUrl: ENTERED_BY_USER,
      fetchedAt: new Date(),
      kind: 'fact',
    });
    const linkedinUrl = input.linkedinUrl?.trim();
    const linkedinId = linkedinUrl ? linkedinIdFromUrl(linkedinUrl) : null;
    // The same person typed in twice (a double click, a second try) is one person: match the
    // company's existing people by LinkedIn ID, email or phone before storing a new one.
    const wantEmail = input.email?.trim() ? normalizeEmail(input.email) : null;
    const wantPhone = input.phone?.trim() ? phoneKey(input.phone) : null;
    const known = (
      await tx.query<{
        id: string;
        email: string | null;
        phone: string | null;
        linkedin_public_id: string | null;
      }>(
        'SELECT id, email, phone, linkedin_public_id FROM contacts WHERE user_id = $1 AND company_id = $2',
        [userId, card.company_id],
      )
    ).rows.find(
      (c) =>
        (linkedinId !== null && c.linkedin_public_id === linkedinId) ||
        (wantEmail !== null && c.email !== null && normalizeEmail(c.email) === wantEmail) ||
        (wantPhone !== null && c.phone !== null && phoneKey(c.phone) === wantPhone),
    );
    let contactId: string;
    try {
      if (known) {
        const blocked = await findSuppressed(tx, {
          email: input.email ?? null,
          phone: input.phone ?? null,
          linkedinPublicId: linkedinId,
        });
        if (blocked.length > 0) throw new SuppressedContactError(blocked);
        contactId = known.id;
      } else {
        const { contact } = await upsertContact(tx, userId, {
          companyId: card.company_id,
          fullName: src(fullName),
          ...(input.title?.trim() ? { title: src(input.title.trim()) } : {}),
          ...(input.roleClass
            ? { roleClass: { ...src(input.roleClass), kind: 'estimate' as const } }
            : {}),
          ...(input.email?.trim() ? { email: src(input.email.trim()) } : {}),
          ...(input.phone?.trim() ? { phone: src(input.phone.trim()) } : {}),
          ...(linkedinUrl ? { linkedinUrl: src(linkedinUrl) } : {}),
          ...(linkedinId ? { linkedinPublicId: src(linkedinId) } : {}),
        });
        contactId = contact.id;
      }
    } catch (err) {
      if (err instanceof SuppressedContactError) {
        throw new BoardError(
          'suppressed',
          `This person asked not to be contacted (${err.kinds.join(', ')})`,
        );
      }
      throw err;
    }

    // The person's card: new, or back out of Noise when the same person is added again.
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO crm_cards (user_id, pipeline, stage, company_id, contact_id)
       VALUES ($1, 'people', 'new', $2, $3)
       ON CONFLICT (user_id, pipeline, company_id, contact_id) DO UPDATE SET
         stage = CASE WHEN crm_cards.stage = 'noise' THEN 'new' ELSE crm_cards.stage END,
         stage_entered_at = CASE WHEN crm_cards.stage = 'noise' THEN now() ELSE crm_cards.stage_entered_at END,
         noise_at = NULL, noise_from_stage = NULL, updated_at = now()
       RETURNING id`,
      [userId, card.company_id, contactId],
    );
    await tx.query(
      `UPDATE crm_leads SET stage = 'system_suggested', stage_changed_at = now(), updated_at = now()
        WHERE user_id = $1 AND company_id = $2 AND contact_id = $3 AND stage = 'dismissed'`,
      [userId, card.company_id, contactId],
    );
    await setStage(tx, card, 'decision_maker_identified');
    return {
      company: (await getCard(tx, userId, card.id, retentionDays))!,
      person: (await getCard(tx, userId, rows[0]!.id, retentionDays))!,
    };
  });
}

// ---------------------------------------------------------------------------------------
// New leads join the board

/** Puts a company on the Companies board in Found. A company already there stays where it is. */
export async function ensureCompanyCard(
  db: Queryable,
  userId: UserId,
  companyId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO crm_cards (user_id, pipeline, stage, company_id) VALUES ($1, 'companies', 'found', $2)
     ON CONFLICT DO NOTHING`,
    [userId, companyId],
  );
}

// ---------------------------------------------------------------------------------------
// Markers: what dedupe still knows after a Noise card is purged

/** True when a company was purged from Noise: a later run must skip it. */
export async function isCompanyRemoved(
  db: Queryable,
  userId: UserId,
  place: { placeId?: string | null; name: string; phone?: string | null; governorate: string },
): Promise<boolean> {
  const phone = place.phone ? phoneKey(place.phone) : '';
  const { rows } = await db.query(
    `SELECT 1 FROM noise_markers
      WHERE user_id = $1 AND kind = 'company' AND (
            ($2::text IS NOT NULL AND google_place_id = $2)
         OR ($4::text <> '' AND phone_key = $4 AND normalized_name = $3)
         OR (google_place_id IS NULL AND phone_key IS NULL AND normalized_name = $3 AND governorate = $5))
      LIMIT 1`,
    [
      userId,
      place.placeId?.trim() || null,
      normalizeCompanyName(place.name),
      phone,
      place.governorate,
    ],
  );
  return rows.length > 0;
}

/** True when a person was purged from Noise: a later run must not store them again. */
export async function isPersonRemoved(
  db: Queryable,
  userId: UserId,
  ids: { linkedinPublicId?: string | null; email?: string | null; phone?: string | null },
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM noise_markers
      WHERE user_id = $1 AND kind = 'person' AND (
            ($2::text IS NOT NULL AND linkedin_public_id = $2)
         OR ($3::text IS NOT NULL AND email = $3)
         OR ($4::text <> '' AND phone_key = $4))
      LIMIT 1`,
    [
      userId,
      ids.linkedinPublicId ? normalizeLinkedinId(ids.linkedinPublicId) : null,
      ids.email ? normalizeEmail(ids.email) : null,
      ids.phone ? phoneKey(ids.phone) : '',
    ],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------
// The daily purge

/**
 * Deletes Noise cards older than the retention, for every user, and keeps a marker for each.
 * People go first (their contact row is deleted); a company goes only when nothing else hangs
 * on it, so a company with a live or Opted out person stays. Opted out cards have no noise_at
 * (the table forbids it), so they are never selected here.
 */
export async function purgeNoise(
  db: Queryable,
  retentionDays: number,
  now: Date = new Date(),
): Promise<{ people: number; companies: number }> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  return withTransaction(db, async (tx) => {
    const people = await tx.query<{
      card_id: string;
      user_id: string;
      contact_id: string;
      email: string | null;
      phone: string | null;
      linkedin_public_id: string | null;
      role_class: string | null;
      sector: string | null;
    }>(
      `SELECT k.id AS card_id, k.user_id, k.contact_id, p.email, p.phone, p.linkedin_public_id,
              p.role_class, c.sector
         FROM crm_cards k JOIN contacts p ON p.id = k.contact_id JOIN companies c ON c.id = k.company_id
        WHERE k.pipeline = 'people' AND k.stage = 'noise' AND k.noise_at < $1 FOR UPDATE OF k`,
      [cutoff],
    );
    for (const p of people.rows) {
      await tx.query(
        `INSERT INTO noise_markers (user_id, kind, email, phone_key, linkedin_public_id, sector, role_class)
         VALUES ($1, 'person', $2, $3, $4, $5, $6)`,
        [
          p.user_id,
          p.email ? normalizeEmail(p.email) : null,
          p.phone ? phoneKey(p.phone) : null,
          p.linkedin_public_id,
          p.sector,
          p.role_class,
        ],
      );
      await tx.query('DELETE FROM contacts WHERE id = $1', [p.contact_id]);
    }

    const companies = await tx.query<{
      company_id: string;
      user_id: string;
      google_place_id: string | null;
      normalized_name: string;
      governorate: string;
      phone: string | null;
      sector: string | null;
    }>(
      `SELECT c.id AS company_id, c.user_id, c.google_place_id, c.normalized_name, c.governorate,
              c.phone, c.sector
         FROM crm_cards k JOIN companies c ON c.id = k.company_id
        WHERE k.pipeline = 'companies' AND k.stage = 'noise' AND k.noise_at < $1
          AND NOT EXISTS (SELECT 1 FROM crm_cards o WHERE o.company_id = c.id AND o.id <> k.id)
        FOR UPDATE OF k`,
      [cutoff],
    );
    for (const c of companies.rows) {
      await tx.query(
        `INSERT INTO noise_markers (user_id, kind, google_place_id, normalized_name, governorate, phone_key, sector)
         VALUES ($1, 'company', $2, $3, $4, $5, $6)`,
        [
          c.user_id,
          c.google_place_id,
          c.normalized_name,
          c.governorate,
          c.phone ? phoneKey(c.phone) : null,
          c.sector,
        ],
      );
      await tx.query('DELETE FROM companies WHERE id = $1', [c.company_id]);
    }
    return { people: people.rows.length, companies: companies.rows.length };
  });
}
