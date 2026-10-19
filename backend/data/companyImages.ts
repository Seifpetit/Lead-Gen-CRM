import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// Where a company's thumbnail address is kept. Only the address is stored, never the picture.

/** The Google Maps photo address, kept only when nothing better is known yet. */
export async function setMapsImage(
  db: Queryable,
  userId: UserId,
  companyId: string,
  url: string,
): Promise<void> {
  await db.query(
    `UPDATE companies SET image_url = $3, image_source = 'maps'
      WHERE user_id = $1 AND id = $2 AND image_url IS NULL`,
    [userId, companyId, url],
  );
}

export interface PendingImageLookup {
  id: string;
  userId: UserId;
  website: string | null;
  runId: string | null;
}

/** Companies the free image lookup has not run for yet, oldest first. */
export async function listPendingImageLookups(
  db: Queryable,
  limit: number,
): Promise<PendingImageLookup[]> {
  const { rows } = await db.query<{
    id: string;
    user_id: UserId;
    website: string | null;
    run_id: string | null;
  }>(
    `SELECT id, user_id, website, run_id FROM companies
      WHERE image_checked_at IS NULL ORDER BY created_at, id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, userId: r.user_id, website: r.website, runId: r.run_id }));
}

/**
 * Marks the lookup done. A page image replaces a Maps photo (it is preferred); finding none
 * leaves whatever is there.
 */
export async function finishImageLookup(
  db: Queryable,
  userId: UserId,
  companyId: string,
  pageImage: string | null,
): Promise<void> {
  await db.query(
    `UPDATE companies
        SET image_url = COALESCE($3, image_url),
            image_source = CASE WHEN $3::text IS NULL THEN image_source ELSE 'og' END,
            image_checked_at = now()
      WHERE user_id = $1 AND id = $2`,
    [userId, companyId, pageImage],
  );
}

/** A person's photo address, when the provider returned one. */
export async function setContactPhoto(
  db: Queryable,
  userId: UserId,
  contactId: string,
  url: string,
): Promise<void> {
  await db.query('UPDATE contacts SET photo_url = $3 WHERE user_id = $1 AND id = $2', [
    userId,
    contactId,
    url,
  ]);
}
