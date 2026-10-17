import { normalizeTitle } from '../config/titles.js';
import type { CostEntry } from '../lib/cost.js';
import { normalizeDomain } from '../lib/normalize.js';
import { ApifyClient, apifyRunUrl, collectApifyRun, estimateEvent } from './apify.js';
import type { Clock } from './http.js';
import { sourced, text } from './sourcing.js';
import type {
  ApifyRunRef,
  EmailFinder,
  EmailQuery,
  EmailStatus,
  FoundEmail,
  ProviderJob,
  RunOptions,
} from './types.js';

export const EMAIL_FINDER_ACTOR = 'crustapi/email-finder-verifier';

export interface EmailItem {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  companyDomain?: string;
  email?: string;
  emailStatus?: string;
}

const STATUS: Record<string, EmailStatus> = {
  verified: 'valid',
  valid: 'valid',
  invalid: 'invalid',
  catch_all: 'catch_all',
  'catch-all': 'catch_all',
  accept_all: 'catch_all',
  unknown: 'unknown',
};

/** Ties a result to its query: accent-free names plus the bare domain. */
export function emailLookupKey(firstName: string, lastName: string, domain: string): string {
  return [normalizeTitle(firstName), normalizeTitle(lastName), normalizeDomain(domain) ?? domain]
    .join('|')
    .toLowerCase();
}

/** "Jane Doe, acme.tn": the Actor's one-lead-per-line input. Commas would split a field. */
export function leadLine(q: EmailQuery): string {
  const clean = (s: string) =>
    s
      .replace(/[,\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${clean(q.firstName)} ${clean(q.lastName)}, ${clean(normalizeDomain(q.domain) ?? q.domain)}`;
}

export function mapEmails(items: EmailItem[], run: ApifyRunRef, readAt: Date): FoundEmail[] {
  const out: FoundEmail[] = [];
  for (const item of items) {
    const first = text(item.firstName);
    const last = text(item.lastName);
    const domain = text(item.companyDomain);
    if (!first || !last || !domain) continue;
    const raw = text(item.emailStatus);
    const email = text(item.email)?.toLowerCase() ?? null;
    const status: EmailStatus = email
      ? (STATUS[raw?.toLowerCase() ?? ''] ?? 'unknown')
      : 'not_found';
    out.push({
      key: emailLookupKey(first, last, domain),
      // A found address is a pattern guess, even when the server accepts it: an estimate.
      email: sourced(email, apifyRunUrl(run), readAt, 'estimate'),
      status,
      rawStatus: raw,
    });
  }
  return out;
}

/** Finds and verifies a work email from a name and company domain. */
export class EmailFinderVerifier implements EmailFinder {
  readonly name = EMAIL_FINDER_ACTOR;
  constructor(
    private readonly client: ApifyClient,
    private readonly now: Clock = () => new Date(),
  ) {}

  input(queries: EmailQuery[]) {
    return { leads: queries.map(leadLine), maxItems: queries.length };
  }

  /** Worst case: every lookup returns a verified address (catch-all and unknown are free). */
  estimate(queries: EmailQuery[]): CostEntry[] {
    return [estimateEvent(EMAIL_FINDER_ACTOR, 'email-found-verified', queries.length)];
  }

  async findEmails(queries: EmailQuery[], options?: RunOptions): Promise<ProviderJob<FoundEmail>> {
    if (queries.length === 0) {
      return { state: 'succeeded', run: null, items: [], costs: [], usage: null };
    }
    const run = await this.client.startRun(EMAIL_FINDER_ACTOR, this.input(queries), options);
    return { state: 'started', run: run.ref, costs: [] };
  }

  collect(ref: ApifyRunRef): Promise<ProviderJob<FoundEmail>> {
    return collectApifyRun<EmailItem, FoundEmail>(this.client, ref, (items, run) =>
      mapEmails(items, run.ref, this.now()),
    );
  }
}
