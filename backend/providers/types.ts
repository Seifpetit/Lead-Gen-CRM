import type { CostEntry } from '../lib/cost.js';
import type { Bounds } from '../lib/geo.js';
import type { Sourced } from '../lib/sourced.js';

// One interface per stage: discoverCompanies, findPeople, findEmails. Adapters start a run
// (or make a request) and read results; they never touch the database. Every value they
// return is Sourced, and every paid call returns CostEntry rows for the runner to record.

/** An Apify Actor run, stored by the runner before it waits on anything. */
export interface ApifyRunRef {
  actorId: string;
  runId: string;
  datasetId: string;
}

export type ApifyRunStatus =
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMING-OUT'
  | 'TIMED-OUT'
  | 'ABORTING'
  | 'ABORTED';

/** What Apify reports about a run's charges. */
export interface ApifyUsage {
  /** Pay-per-event counts, e.g. { "place-scraped": 120 }. */
  chargedEventCounts: Record<string, number>;
  /** Platform usage in USD as Apify reports it (not charged for pay-per-event Actors). */
  usageTotalUsd: number | null;
}

/**
 * The state of one unit of provider work.
 * - started/running: an Apify run exists; the runner stores `run` and polls `collect` later.
 * - succeeded: items are ready. Synchronous providers (Google Places) return this at once.
 * - failed: the run ended without a dataset worth reading; costs still count.
 */
export type ProviderJob<T> =
  | { state: 'started' | 'running'; run: ApifyRunRef; costs: CostEntry[] }
  | {
      state: 'succeeded';
      run: ApifyRunRef | null;
      items: T[];
      costs: CostEntry[];
      usage: ApifyUsage | null;
    }
  | {
      state: 'failed';
      run: ApifyRunRef | null;
      status: string;
      costs: CostEntry[];
      usage: ApifyUsage | null;
    };

/** Per-call limits. maxTotalChargeUsd is passed to Apify so the run stops at that spend. */
export interface RunOptions {
  maxTotalChargeUsd?: number;
}

/** Shared by all stage providers: estimate before spending, collect a started run later. */
export interface StageProvider<T> {
  readonly name: string;
  /** Re-reads an Apify run started earlier (after a restart, or on a webhook). */
  collect(run: ApifyRunRef): Promise<ProviderJob<T>>;
}

// ---------------------------------------------------------------------------------------
// discoverCompanies

/** One search: a wording in a map rectangle. Produced by the query grid. */
export interface DiscoveryQuery {
  regionId: string;
  cellKey: string;
  bounds: Bounds;
  sectorId: string;
  textQuery: string;
  normalizedQuery: string;
  languageCode: 'fr' | 'en';
  /** Upper bound on places to return for this query. */
  maxPlaces: number;
}

export interface DiscoveredPlace {
  provider: 'google_places' | 'apify_google_maps';
  placeId: Sourced<string>;
  name: Sourced<string>;
  address: Sourced<string> | null;
  /** Main category label ("Usine textile", "Food manufacturer"). */
  category: Sourced<string> | null;
  /** Google place types or Maps category list, as returned. */
  types: string[];
  website: Sourced<string> | null;
  phones: Sourced<string>[];
  /** Emails found on the company website by contact enrichment. */
  emails: Sourced<string>[];
  linkedinUrl: Sourced<string> | null;
  location: { lat: number; lng: number } | null;
  /** OPERATIONAL, CLOSED_TEMPORARILY or CLOSED_PERMANENTLY when known. */
  businessStatus: string | null;
  reviewsCount: number | null;
  mapsUrl: string;
}

export interface CompanyDiscovery extends StageProvider<DiscoveredPlace> {
  /** Cost of a query at its maxPlaces, before any spend. */
  estimate(query: DiscoveryQuery): CostEntry[];
  discoverCompanies(
    query: DiscoveryQuery,
    options?: RunOptions,
  ): Promise<ProviderJob<DiscoveredPlace>>;
}

// ---------------------------------------------------------------------------------------
// findPeople

export interface Position {
  title: string;
  companyName: string;
  companyLinkedinUrl: string | null;
  /** "2021-03" or "2021"; null when not listed. */
  startDate: string | null;
  /** Null or absent means no end date. */
  endDate: string | null;
}

export interface FoundPerson {
  via: 'company_employees' | 'profile_search';
  fullName: Sourced<string>;
  /** Current headline or title as listed. */
  headline: Sourced<string> | null;
  linkedinUrl: Sourced<string>;
  linkedinPublicId: string | null;
  location: Sourced<string> | null;
  /** Experience entries as listed; short profiles may only include the current ones. */
  positions: Position[];
}

export interface PeopleQuery {
  companyName: string;
  /** Present when the company has a LinkedIn page; otherwise profile search is used. */
  companyLinkedinUrl: string | null;
  /** Title words to filter on (from the title dictionary). */
  titleKeywords: string[];
  /** e.g. "Sfax, Tunisia". */
  location: string;
  maxPeople: number;
}

export interface PeopleFinder extends StageProvider<FoundPerson> {
  estimate(query: PeopleQuery): CostEntry[];
  findPeople(query: PeopleQuery, options?: RunOptions): Promise<ProviderJob<FoundPerson>>;
}

// ---------------------------------------------------------------------------------------
// findEmails

export type EmailStatus = 'valid' | 'invalid' | 'catch_all' | 'unknown' | 'not_found';

export interface EmailQuery {
  firstName: string;
  lastName: string;
  domain: string;
}

export interface FoundEmail {
  /** emailLookupKey(firstName, lastName, domain): ties the result back to the contact. */
  key: string;
  /** Null when nothing was found. A found address is always an estimate. */
  email: Sourced<string> | null;
  status: EmailStatus;
  /** Provider's own status string, kept for audit. */
  rawStatus: string | null;
}

export interface EmailFinder extends StageProvider<FoundEmail> {
  estimate(queries: EmailQuery[]): CostEntry[];
  findEmails(queries: EmailQuery[], options?: RunOptions): Promise<ProviderJob<FoundEmail>>;
}
