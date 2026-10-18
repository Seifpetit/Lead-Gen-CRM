import { costEntry, type CostEntry } from '../lib/cost.js';
import { normalizeDomain } from '../lib/normalize.js';
import type { Sourced } from '../lib/sourced.js';
import { emailLookupKey } from '../providers/emailFinder.js';
import { GOOGLE_MAPS_ACTOR } from '../providers/googleMapsApify.js';
import { COMPANY_EMPLOYEES_ACTOR } from '../providers/linkedin.js';
import { EMAIL_FINDER_ACTOR } from '../providers/emailFinder.js';
import type {
  ApifyRunRef,
  ApifyUsage,
  CompanyDiscovery,
  DiscoveredPlace,
  DiscoveryQuery,
  EmailFinder,
  EmailQuery,
  FoundEmail,
  FoundPerson,
  PeopleFinder,
  PeopleQuery,
  ProviderJob,
  RunOptions,
} from '../providers/types.js';

// A fake Apify for the orchestrator tests. Runs are asynchronous like the real thing: a start
// returns a run ID, polls report RUNNING a few times, then the dataset is ready. Every start
// is recorded, so tests can prove a step was never paid for twice. Synthetic data only.

export const FAKE_PLACE_PRICE = 0.004;
export const FAKE_PROFILE_PRICE = 0.004;
export const FAKE_EMAIL_PRICE = 0.01;

interface FakeRun<T> {
  ref: ApifyRunRef;
  /** What the run was started for: a cell and wording, a company, or an email batch. */
  label: string;
  items: T[];
  pollsLeft: number;
  costs: CostEntry[];
  options: RunOptions;
  restarts: number;
  final: 'SUCCEEDED' | 'FAILED' | 'ABORTED';
}

export interface FakeApifyOptions {
  /** RUNNING polls before a run finishes. */
  polls?: number;
  /** Apify bills this fraction of our priced events (usageTotalUsd). 1 = as estimated. */
  billedFactor?: number;
  /** Places per cell key; every wording in a cell finds the same places. */
  placesPerCell?: (cellKey: string) => number;
}

export class FakeApify {
  readonly runs = new Map<string, FakeRun<unknown>>();
  /** Every run started, in order: [actor, label]. */
  readonly starts: { actor: string; label: string }[] = [];
  private seq = 0;

  constructor(readonly options: FakeApifyOptions = {}) {}

  start<T>(
    actor: string,
    label: string,
    items: T[],
    costs: CostEntry[],
    options: RunOptions = {},
  ): ProviderJob<T> {
    this.seq += 1;
    const ref = {
      actorId: actor,
      runId: `fakeRun${this.seq}`,
      datasetId: `fakeDataset${this.seq}`,
    };
    // A max-cost cap trims the dataset the way Apify stops charging at the cap.
    let kept = items;
    let final: FakeRun<T>['final'] = 'SUCCEEDED';
    const perItem =
      items.length > 0 ? costs.reduce((s, c) => s + c.amountUsd, 0) / items.length : 0;
    if (options.maxTotalChargeUsd !== undefined && perItem > 0) {
      const affordable = Math.floor(options.maxTotalChargeUsd / perItem + 1e-9);
      if (affordable < items.length) {
        kept = items.slice(0, affordable);
        final = 'ABORTED';
      }
    }
    const scale = items.length === 0 ? 0 : kept.length / items.length;
    const charged = costs.map((c) =>
      costEntry(c.provider, c.item, Math.round(c.units * scale), c.unitPriceUsd),
    );
    this.runs.set(ref.runId, {
      ref,
      label,
      items: kept,
      pollsLeft: this.options.polls ?? 1,
      costs: charged,
      options,
      restarts: 0,
      final,
    });
    this.starts.push({ actor, label });
    return { state: 'started', run: ref, costs: [] };
  }

  collect<T>(ref: ApifyRunRef): ProviderJob<T> {
    const run = this.runs.get(ref.runId) as FakeRun<T> | undefined;
    if (!run) throw new Error(`Unknown fake run ${ref.runId}`);
    if (run.pollsLeft > 0) {
      run.pollsLeft -= 1;
      return { state: 'running', run: ref, costs: [], status: 'RUNNING', restarts: run.restarts };
    }
    const priced = run.costs.reduce((s, c) => s + c.amountUsd, 0);
    const usage: ApifyUsage = {
      chargedEventCounts: Object.fromEntries(run.costs.map((c) => [c.item, c.units])),
      usageTotalUsd: Math.round(priced * (this.options.billedFactor ?? 1) * 1e6) / 1e6,
      restarts: run.restarts,
    };
    if (run.final === 'SUCCEEDED') {
      return { state: 'succeeded', run: ref, items: run.items, costs: run.costs, usage };
    }
    return {
      state: 'failed',
      run: ref,
      status: run.final,
      costs: run.costs,
      usage,
      items: run.items,
    };
  }

  /** Simulates Apify migrating a running run to another server. */
  migrate(runId: string): void {
    const run = this.runs.get(runId);
    if (run) run.restarts += 1;
  }

  startsFor(actor: string): string[] {
    return this.starts.filter((s) => s.actor === actor).map((s) => s.label);
  }
}

const AT = new Date('2026-10-17T12:00:00.000Z');

const src = <T>(value: T, sourceUrl: string, kind: 'fact' | 'estimate' = 'fact'): Sourced<T> => ({
  value,
  sourceUrl,
  fetchedAt: AT,
  kind,
});

export function fakePlace(cellKey: string, i: number): DiscoveredPlace {
  const id = `${cellKey.replace(/[^a-z0-9]/gi, '')}x${i}`;
  const maps = `https://maps.example.test/place/${id}`;
  return {
    provider: 'apify_google_maps',
    placeId: src(`fake-place-${id}`, maps),
    name: src(`Fixture Textile ${id}`, maps),
    address: src(`Zone industrielle ${id}`, maps),
    category: src('Usine textile', maps),
    types: ['textile'],
    website: src(`https://fixture-${id.toLowerCase()}.example.tn`, maps),
    phones: [],
    emails: [],
    linkedinUrl: src(`https://www.linkedin.com/company/fixture-${id.toLowerCase()}`, maps),
    location: null,
    businessStatus: 'OPERATIONAL',
    reviewsCount: 3,
    mapsUrl: maps,
  };
}

export class FakeDiscovery implements CompanyDiscovery {
  readonly name = GOOGLE_MAPS_ACTOR;
  constructor(private readonly apify: FakeApify) {}

  private placesFor(q: DiscoveryQuery): DiscoveredPlace[] {
    const n = Math.min(this.apify.options.placesPerCell?.(q.cellKey) ?? 2, q.maxPlaces);
    return Array.from({ length: n }, (_, i) => fakePlace(q.cellKey, i));
  }

  estimate(q: DiscoveryQuery): CostEntry[] {
    return [costEntry('apify', `${this.name}#place-scraped`, q.maxPlaces, FAKE_PLACE_PRICE)];
  }

  async discoverCompanies(q: DiscoveryQuery, options?: RunOptions) {
    const places = this.placesFor(q);
    const costs = [
      costEntry('apify', `${this.name}#place-scraped`, places.length, FAKE_PLACE_PRICE),
    ];
    return this.apify.start(this.name, `${q.cellKey}|${q.normalizedQuery}`, places, costs, options);
  }

  async collect(run: ApifyRunRef) {
    return this.apify.collect<DiscoveredPlace>(run);
  }
}

export class FakePeople implements PeopleFinder {
  // Named like the real LinkedinPeopleFinder, which wraps two Actors.
  readonly name = 'linkedin';
  private readonly actor = COMPANY_EMPLOYEES_ACTOR;
  constructor(private readonly apify: FakeApify) {}

  estimate(q: PeopleQuery): CostEntry[] {
    return [costEntry('apify', `${this.actor}#profile`, q.maxPeople, FAKE_PROFILE_PRICE)];
  }

  async findPeople(q: PeopleQuery, options?: RunOptions) {
    const slug = (q.companyLinkedinUrl ?? q.companyName).split('/').pop()!;
    const url = `https://www.linkedin.com/in/${slug}-director`;
    const person: FoundPerson = {
      via: 'company_employees',
      fullName: src(`Amine Testeur${slug.replace(/[^a-z0-9]/gi, '').slice(-6)}`, url),
      headline: src('Directeur Logistique', url),
      linkedinUrl: src(url, url),
      linkedinPublicId: `${slug}-director`,
      location: src('Tunisia', url),
      positions: [
        {
          title: 'Directeur Logistique',
          companyName: q.companyName,
          companyLinkedinUrl: q.companyLinkedinUrl,
          startDate: '2020-01',
          endDate: null,
        },
      ],
    };
    const costs = [costEntry('apify', `${this.actor}#profile`, 1, FAKE_PROFILE_PRICE)];
    return this.apify.start(this.actor, q.companyName, [person], costs, options);
  }

  async collect(run: ApifyRunRef) {
    return this.apify.collect<FoundPerson>(run);
  }
}

export class FakeEmails implements EmailFinder {
  readonly name = EMAIL_FINDER_ACTOR;
  constructor(private readonly apify: FakeApify) {}

  estimate(queries: EmailQuery[]): CostEntry[] {
    return [costEntry('apify', `${this.name}#lookup`, queries.length, FAKE_EMAIL_PRICE)];
  }

  async findEmails(queries: EmailQuery[], options?: RunOptions) {
    const found: FoundEmail[] = queries.map((q) => {
      const domain = normalizeDomain(q.domain) ?? q.domain;
      const runUrl = 'https://console.apify.com/view/runs/fake';
      return {
        key: emailLookupKey(q.firstName, q.lastName, q.domain),
        email: src(`${q.firstName}.${q.lastName}@${domain}`.toLowerCase(), runUrl, 'estimate'),
        status: 'valid',
        rawStatus: 'verified',
      };
    });
    const costs = [costEntry('apify', `${this.name}#lookup`, queries.length, FAKE_EMAIL_PRICE)];
    return this.apify.start(
      this.name,
      queries.map((q) => q.lastName).join(','),
      found,
      costs,
      options,
    );
  }

  async collect(run: ApifyRunRef) {
    return this.apify.collect<FoundEmail>(run);
  }
}

export function fakeProviders(options: FakeApifyOptions = {}) {
  const apify = new FakeApify(options);
  return {
    apify,
    discovery: new FakeDiscovery(apify),
    people: new FakePeople(apify),
    emails: new FakeEmails(apify),
  };
}
