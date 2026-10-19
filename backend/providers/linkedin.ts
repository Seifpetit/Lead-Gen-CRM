import type { CostEntry } from '../lib/cost.js';
import { ApifyClient, collectApifyRun, estimateEvent, type ApifyRun } from './apify.js';
import type { Clock } from './http.js';
import { fetchedAtOf, httpUrl, sourced, text } from './sourcing.js';
import type {
  ApifyRunRef,
  FoundPerson,
  PeopleFinder,
  PeopleQuery,
  Position,
  ProviderJob,
  RunOptions,
} from './types.js';

export const COMPANY_EMPLOYEES_ACTOR = 'harvestapi/linkedin-company-employees';
export const PROFILE_SEARCH_ACTOR = 'harvestapi/linkedin-profile-search';

const MAX_FILTER_VALUES = 50;
const SEARCH_PAGE_SIZE = 25;

type DateField = string | { text?: string; year?: number; month?: string | number } | null;

/**
 * Profile fields read from both harvestapi Actors. Short mode has no published sample, so
 * the mapper accepts the field names of the full-mode sample plus common alternatives.
 */
export interface LinkedinItem {
  publicIdentifier?: string;
  linkedinUrl?: string;
  profileUrl?: string;
  url?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  headline?: string;
  position?: string;
  /** Profile photo, as an address or an object holding one; field names vary by Actor. */
  photo?: string | { url?: string };
  pictureUrl?: string;
  profilePicture?: string | { url?: string };
  location?: string | { linkedinText?: string; text?: string };
  currentPosition?: {
    companyName?: string;
    position?: string;
    title?: string;
    companyLinkedinUrl?: string;
    startDate?: DateField;
  }[];
  experience?: {
    position?: string;
    title?: string;
    companyName?: string;
    companyLinkedinUrl?: string;
    startDate?: DateField;
    endDate?: DateField;
    duration?: string;
  }[];
  scrapedAt?: string;
}

/** The photo address if the item has one: a string or an object with `url`, http(s) only. */
function photoOf(item: LinkedinItem): string | null {
  for (const v of [item.photo, item.pictureUrl, item.profilePicture]) {
    const url = httpUrl(typeof v === 'string' ? v : v?.url);
    if (url) return url;
  }
  return null;
}

const PRESENT = /^(present|now|current|aujourd.?hui|actuel(le)?|en cours)$/i;

/** "Mar 2021" / {year: 2021, month: 3} / "Present" -> "Mar 2021" / "2021-03" / null. */
export function dateText(d: DateField | undefined): string | null {
  if (d === null || d === undefined) return null;
  if (typeof d === 'string') {
    const t = d.trim();
    return t === '' || PRESENT.test(t) ? null : t;
  }
  const t = text(d.text);
  if (t) return PRESENT.test(t) ? null : t;
  if (typeof d.year === 'number') {
    if (typeof d.month === 'number') return `${d.year}-${String(d.month).padStart(2, '0')}`;
    if (typeof d.month === 'string' && d.month.trim() !== '') return `${d.month.trim()} ${d.year}`;
    return String(d.year);
  }
  return null;
}

/** End date from an experience entry; a "2019 - 2022" duration counts when no endDate is given. */
function endDateOf(e: NonNullable<LinkedinItem['experience']>[number]): string | null {
  const explicit = dateText(e.endDate);
  if (explicit) return explicit;
  if (e.endDate === undefined && typeof e.duration === 'string') {
    const m = /[-–]\s*([^·]+?)\s*(·|$)/.exec(e.duration);
    const end = m?.[1]?.trim();
    if (end && !PRESENT.test(end)) return end;
  }
  return null;
}

export function publicIdFromUrl(url: string): string | null {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  return m ? decodeURIComponent(m[1]!).toLowerCase() : null;
}

export function mapPeople(
  items: LinkedinItem[],
  via: FoundPerson['via'],
  readAt: Date,
): FoundPerson[] {
  const people: FoundPerson[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url = httpUrl(item.linkedinUrl) ?? httpUrl(item.profileUrl) ?? httpUrl(item.url);
    const fullName =
      text(item.fullName) ??
      text(item.name) ??
      ([text(item.firstName), text(item.lastName)].filter(Boolean).join(' ') || null);
    // No profile URL to cite or no name: not a usable person.
    if (!url || !/linkedin\.com\/in\//i.test(url) || !fullName) continue;
    const publicId = text(item.publicIdentifier)?.toLowerCase() ?? publicIdFromUrl(url);
    const key = publicId ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = fetchedAtOf(item.scrapedAt, readAt);
    const fact = (v: string | null) => sourced(v, url, at, 'fact');
    const positions: Position[] = [];
    for (const e of item.experience ?? []) {
      const companyName = text(e.companyName);
      const title = text(e.position) ?? text(e.title);
      if (!companyName || !title) continue;
      positions.push({
        title,
        companyName,
        companyLinkedinUrl: httpUrl(e.companyLinkedinUrl),
        startDate: dateText(e.startDate),
        endDate: endDateOf(e),
      });
    }
    // Current positions carry no end date by definition; add those experience lacks.
    for (const c of item.currentPosition ?? []) {
      const companyName = text(c.companyName);
      const title = text(c.position) ?? text(c.title) ?? text(item.position) ?? text(item.headline);
      if (!companyName || !title) continue;
      const already = positions.some(
        (p) => p.companyName === companyName && p.title === title && p.endDate === null,
      );
      if (!already) {
        positions.push({
          title,
          companyName,
          companyLinkedinUrl: httpUrl(c.companyLinkedinUrl),
          startDate: dateText(c.startDate),
          endDate: null,
        });
      }
    }
    const location =
      typeof item.location === 'string'
        ? text(item.location)
        : (text(item.location?.linkedinText) ?? text(item.location?.text));
    people.push({
      via,
      fullName: fact(fullName)!,
      headline: fact(text(item.headline) ?? text(item.position)),
      linkedinUrl: fact(url)!,
      linkedinPublicId: publicId,
      location: fact(location),
      photoUrl: photoOf(item),
      positions,
    });
  }
  return people;
}

const collectPeople = (
  client: ApifyClient,
  ref: ApifyRunRef,
  now: Clock,
): Promise<ProviderJob<FoundPerson>> =>
  collectApifyRun<LinkedinItem, FoundPerson>(client, ref, (items, run: ApifyRun) =>
    mapPeople(
      items,
      run.ref.actorId === PROFILE_SEARCH_ACTOR ? 'profile_search' : 'company_employees',
      now(),
    ),
  );

/** Employees of a company with a LinkedIn page, short profiles, filtered by title and place. */
export class CompanyEmployeesFinder implements PeopleFinder {
  readonly name = COMPANY_EMPLOYEES_ACTOR;
  constructor(
    private readonly client: ApifyClient,
    private readonly now: Clock = () => new Date(),
  ) {}

  input(q: PeopleQuery) {
    if (!q.companyLinkedinUrl) throw new Error('Company employees search needs a LinkedIn page');
    return {
      companies: [q.companyLinkedinUrl],
      profileScraperMode: 'Short ($4 per 1k)',
      jobTitles: q.titleKeywords.slice(0, MAX_FILTER_VALUES),
      locations: [q.location],
      maxItems: q.maxPeople,
    };
  }

  estimate(q: PeopleQuery): CostEntry[] {
    return [
      estimateEvent(COMPANY_EMPLOYEES_ACTOR, 'actor-start', 1),
      estimateEvent(COMPANY_EMPLOYEES_ACTOR, 'short-profile', q.maxPeople),
    ];
  }

  async findPeople(q: PeopleQuery, options?: RunOptions): Promise<ProviderJob<FoundPerson>> {
    const run = await this.client.startRun(COMPANY_EMPLOYEES_ACTOR, this.input(q), options);
    return { state: 'started', run: run.ref, costs: [] };
  }

  collect(ref: ApifyRunRef) {
    return collectPeople(this.client, ref, this.now);
  }
}

/** Fallback for companies without a LinkedIn page: search profiles by company name. */
export class ProfileSearchFinder implements PeopleFinder {
  readonly name = PROFILE_SEARCH_ACTOR;
  constructor(
    private readonly client: ApifyClient,
    private readonly now: Clock = () => new Date(),
  ) {}

  input(q: PeopleQuery) {
    return {
      searchQuery: q.companyName.slice(0, 300),
      currentJobTitles: q.titleKeywords.slice(0, MAX_FILTER_VALUES),
      locations: [q.location],
      profileScraperMode: 'Short',
      maxItems: q.maxPeople,
    };
  }

  estimate(q: PeopleQuery): CostEntry[] {
    return [
      estimateEvent(
        PROFILE_SEARCH_ACTOR,
        'search-page',
        Math.max(1, Math.ceil(q.maxPeople / SEARCH_PAGE_SIZE)),
      ),
    ];
  }

  async findPeople(q: PeopleQuery, options?: RunOptions): Promise<ProviderJob<FoundPerson>> {
    const run = await this.client.startRun(PROFILE_SEARCH_ACTOR, this.input(q), options);
    return { state: 'started', run: run.ref, costs: [] };
  }

  collect(ref: ApifyRunRef) {
    return collectPeople(this.client, ref, this.now);
  }
}

/** Company employees when the company has a LinkedIn page, profile search otherwise. */
export class LinkedinPeopleFinder implements PeopleFinder {
  readonly name = 'linkedin';
  constructor(
    private readonly employees: CompanyEmployeesFinder,
    private readonly search: ProfileSearchFinder,
  ) {}

  private pick(q: PeopleQuery): PeopleFinder {
    return q.companyLinkedinUrl ? this.employees : this.search;
  }

  estimate(q: PeopleQuery) {
    return this.pick(q).estimate(q);
  }

  findPeople(q: PeopleQuery, options?: RunOptions) {
    return this.pick(q).findPeople(q, options);
  }

  collect(ref: ApifyRunRef) {
    return ref.actorId === PROFILE_SEARCH_ACTOR
      ? this.search.collect(ref)
      : this.employees.collect(ref);
  }
}
