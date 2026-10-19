import { recordCost } from '../data/costLedger.js';
import { finishImageLookup, listPendingImageLookups } from '../data/companyImages.js';
import type { Db } from '../data/db.js';
import { fetchPage, type PageFetchOptions } from '../lib/safeFetch.js';
import { parsePageImage } from '../lib/pageImage.js';

/** Looks for a page's preview image; null when there is none or the page cannot be read. */
export async function lookupPageImage(
  website: string,
  options: PageFetchOptions = {},
): Promise<string | null> {
  try {
    const page = await fetchPage(website, options);
    return parsePageImage(page.html, page.url);
  } catch {
    return null;
  }
}

/**
 * The free image step: for each company that has not had one, reads its website's og:image
 * (or twitter:image) and stores the address. A company with no website is just marked done.
 * Each lookup is written to the cost ledger at $0 against the run that found the company.
 * Returns how many companies were processed.
 */
export async function runImageLookups(
  db: Db,
  limit = 20,
  options: PageFetchOptions = {},
): Promise<number> {
  const pending = await listPendingImageLookups(db, limit);
  for (const company of pending) {
    let image: string | null = null;
    if (company.website) {
      image = await lookupPageImage(company.website, options);
      if (company.runId) {
        await recordCost(db, company.userId, {
          runId: company.runId,
          provider: 'web',
          item: 'company-image-lookup',
          units: 1,
          unitPriceUsd: 0,
          kind: 'actual',
        }).catch(() => undefined);
      }
    }
    await finishImageLookup(db, company.userId, company.id, image);
  }
  return pending.length;
}

/**
 * Runs the image step in the background: soon after start, then every minute while there is
 * work, one company at a time. A failure is logged and retried on the next tick. Returns a
 * function that stops it.
 */
export function startImageBackfill(
  db: Db,
  log: (data: object, message: string) => void,
  intervalMs = 60_000,
): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      while ((await runImageLookups(db)) > 0) {
        // keep going until nothing is pending
      }
    } catch (err) {
      log({ err }, 'image lookup failed');
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
