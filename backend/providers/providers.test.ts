import { beforeAll, describe, expect, it } from 'vitest';
import { blockNetwork, clock, fakeHttp, fixture, FIXED_NOW } from '../test/fixtures.js';
import { ApifyClient, costsFromUsage } from './apify.js';
import {
  EMAIL_FINDER_ACTOR,
  EmailFinderVerifier,
  emailLookupKey,
  leadLine,
} from './emailFinder.js';
import {
  GOOGLE_MAPS_ACTOR,
  GoogleMapsApifyDiscovery,
  mapPlaces,
  mapsInput,
} from './googleMapsApify.js';
import {
  DEFAULT_FIELD_MASK,
  ENTERPRISE_FIELD_MASK,
  GooglePlacesDiscovery,
  skuForFieldMask,
} from './googlePlaces.js';
import {
  COMPANY_EMPLOYEES_ACTOR,
  CompanyEmployeesFinder,
  LinkedinPeopleFinder,
  mapPeople,
  PROFILE_SEARCH_ACTOR,
  ProfileSearchFinder,
} from './linkedin.js';
import type { DiscoveryQuery, PeopleQuery, ProviderJob } from './types.js';

beforeAll(blockNetwork);

const TOKEN = 'apify_api_FAKE_TOKEN';

const query: DiscoveryQuery = {
  regionId: 'sfax',
  cellKey: 'r0c1',
  bounds: { south: 34.6, west: 10.6, north: 34.9, east: 10.9 },
  sectorId: 'olive-oil',
  textQuery: 'huilerie',
  normalizedQuery: 'huilerie',
  languageCode: 'fr',
  maxPlaces: 60,
};

const started = (id: string, datasetId: string) => ({
  data: { id, status: 'READY', defaultDatasetId: datasetId },
});

function succeeded<T>(job: ProviderJob<T>) {
  if (job.state !== 'succeeded') throw new Error(`expected succeeded, got ${job.state}`);
  return job;
}

describe('ApifyClient', () => {
  it('sends the token in a header, never the URL, and passes the spend cap', async () => {
    const http = fakeHttp([[/\/acts\/compass~crawler-google-places\/runs/, started('r1', 'd1')]]);
    const run = await new ApifyClient(TOKEN, http).startRun(
      GOOGLE_MAPS_ACTOR,
      { a: 1 },
      {
        maxTotalChargeUsd: 2.5,
      },
    );
    expect(run.ref).toEqual({ actorId: GOOGLE_MAPS_ACTOR, runId: 'r1', datasetId: 'd1' });
    const call = http.calls[0]!;
    expect(call.url).toContain('maxTotalChargeUsd=2.5');
    expect(call.url).not.toContain(TOKEN);
    expect(call.options.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(call.options.body).toEqual({ a: 1 });
  });

  it('refuses an empty token', () => {
    expect(() => new ApifyClient(' ')).toThrow(/token/);
  });

  it('pages through a dataset', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const http = fakeHttp([
      [/offset=0&/, full],
      [/offset=1000&/, [{ i: 1000 }]],
    ]);
    const items = await new ApifyClient(TOKEN, http).datasetItems('d1');
    expect(items).toHaveLength(1001);
    expect(http.calls).toHaveLength(2);
  });
});

describe('GoogleMapsApifyDiscovery', () => {
  const client = (routes: Parameters<typeof fakeHttp>[0]) => {
    const http = fakeHttp(routes);
    return { http, provider: new GoogleMapsApifyDiscovery(new ApifyClient(TOKEN, http), clock) };
  };

  it('builds the Actor input from a grid query, with website contacts on', () => {
    const input = mapsInput(query);
    expect(input).toMatchObject({
      searchStringsArray: ['huilerie'],
      language: 'fr',
      maxCrawledPlacesPerSearch: 60,
      scrapeContacts: true,
      skipClosedPlaces: true,
    });
    // GeoJSON ring is [lng, lat] and closed.
    const ring = input.customGeolocation.coordinates[0]!;
    expect(ring[0]).toEqual([10.6, 34.6]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it('only starts the run and returns its IDs', async () => {
    const { http, provider } = client([[/\/runs/, started('fixtureMapsRun001', 'ds1')]]);
    const job = await provider.discoverCompanies(query);
    expect(job).toEqual({
      state: 'started',
      run: { actorId: GOOGLE_MAPS_ACTOR, runId: 'fixtureMapsRun001', datasetId: 'ds1' },
      costs: [],
    });
    expect(http.calls).toHaveLength(1);
  });

  it('reports a running run without reading the dataset', async () => {
    const running = fixture<{ data: object }>('apify-run-maps.json');
    const { http, provider } = client([
      [/actor-runs/, { data: { ...running.data, status: 'RUNNING' } }],
    ]);
    const job = await provider.collect({
      actorId: GOOGLE_MAPS_ACTOR,
      runId: 'fixtureMapsRun001',
      datasetId: 'fixtureMapsDataset001',
    });
    expect(job.state).toBe('running');
    expect(http.calls.some((c) => c.url.includes('/datasets/'))).toBe(false);
  });

  it('maps places with sources and prices the charged events', async () => {
    const { provider } = client([
      [/actor-runs\/fixtureMapsRun001/, fixture('apify-run-maps.json')],
      [/datasets\/fixtureMapsDataset001/, fixture('maps-dataset.json')],
    ]);
    const job = succeeded(
      await provider.collect({
        actorId: GOOGLE_MAPS_ACTOR,
        runId: 'fixtureMapsRun001',
        datasetId: 'fixtureMapsDataset001',
      }),
    );
    // The item without a place ID is dropped.
    expect(job.items).toHaveLength(6);
    const oil = job.items[0]!;
    expect(oil.name).toEqual({
      value: 'Huilerie El Fixture',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ-fixture-maps-001',
      fetchedAt: new Date('2026-10-17T09:00:00.000Z'),
      kind: 'fact',
    });
    // Website emails cite the website they were found on.
    expect(oil.emails).toEqual([
      {
        value: 'contact@huilerie-elfixture.example',
        sourceUrl: 'https://huilerie-elfixture.example/',
        fetchedAt: new Date('2026-10-17T09:00:00.000Z'),
        kind: 'fact',
      },
    ]);
    expect(oil.linkedinUrl?.value).toBe('https://www.linkedin.com/company/huilerie-el-fixture/');
    expect(oil.phones.map((p) => p.value)).toEqual(['+21674000101']);
    expect(job.items[1]!.website).toBeNull();
    expect(job.items[5]!.businessStatus).toBe('CLOSED_PERMANENTLY');
    expect(job.costs).toEqual([
      {
        provider: 'apify',
        item: `${GOOGLE_MAPS_ACTOR}#apify-actor-start`,
        units: 4,
        unitPriceUsd: 0.00005,
        amountUsd: 0.0002,
        kind: 'estimated',
      },
      {
        provider: 'apify',
        item: `${GOOGLE_MAPS_ACTOR}#contact-details-scraped`,
        units: 4,
        unitPriceUsd: 0.002,
        amountUsd: 0.008,
        kind: 'estimated',
      },
      {
        provider: 'apify',
        item: `${GOOGLE_MAPS_ACTOR}#place-scraped`,
        units: 6,
        unitPriceUsd: 0.004,
        amountUsd: 0.024,
        kind: 'estimated',
      },
    ]);
    expect(job.usage?.usageTotalUsd).toBe(0.0213);
  });

  it('returns a failed run with the costs Apify charged', async () => {
    const run = fixture<{ data: object }>('apify-run-maps.json');
    const { provider } = client([[/actor-runs/, { data: { ...run.data, status: 'FAILED' } }]]);
    const job = await provider.collect({ actorId: GOOGLE_MAPS_ACTOR, runId: 'x', datasetId: 'y' });
    expect(job).toMatchObject({ state: 'failed', status: 'FAILED' });
    expect(job.costs).toHaveLength(3);
  });

  it('reads what a run stopped by its max cost produced before it stopped', async () => {
    const run = fixture<{ data: object }>('apify-run-maps.json');
    const { provider } = client([
      [/actor-runs/, { data: { ...run.data, status: 'ABORTED' } }],
      [/datasets\/fixtureMapsDataset001/, fixture('maps-dataset.json')],
    ]);
    const job = await provider.collect({
      actorId: GOOGLE_MAPS_ACTOR,
      runId: 'fixtureMapsRun001',
      datasetId: 'fixtureMapsDataset001',
    });
    expect(job).toMatchObject({ state: 'failed', status: 'ABORTED' });
    if (job.state === 'failed') expect(job.items).toHaveLength(6);
  });

  it('estimates a query before spending: places plus contact enrichment', () => {
    const { provider } = client([]);
    const total = provider.estimate(query).reduce((s, c) => s + c.amountUsd, 0);
    expect(total).toBeCloseTo(60 * 0.004 + 60 * 0.002 + 4 * 0.00005, 6);
  });
});

describe('GooglePlacesDiscovery', () => {
  const pages = () =>
    fakeHttp([
      [
        (_u, o) => !(o.body as { pageToken?: string }).pageToken,
        fixture('google-places-page1.json'),
      ],
      [
        (_u, o) => (o.body as { pageToken?: string }).pageToken === 'fixture-page-token-2',
        fixture('google-places-page2.json'),
      ],
    ]);

  it('pages with the same request, French, Tunisia, 20 per page, in the cell rectangle', async () => {
    const http = pages();
    const provider = new GooglePlacesDiscovery({ apiKey: 'FAKE_KEY', http, now: clock });
    const job = succeeded(await provider.discoverCompanies(query));
    expect(http.calls).toHaveLength(2);
    const [first, second] = http.calls.map((c) => c.options.body as Record<string, unknown>);
    expect(first).toEqual({
      textQuery: 'huilerie',
      languageCode: 'fr',
      regionCode: 'TN',
      pageSize: 20,
      locationRestriction: {
        rectangle: {
          low: { latitude: 34.6, longitude: 10.6 },
          high: { latitude: 34.9, longitude: 10.9 },
        },
      },
    });
    expect(second).toEqual({ ...first, pageToken: 'fixture-page-token-2' });
    const headers = http.calls[0]!.options.headers!;
    expect(headers['X-Goog-FieldMask']).toBe([...DEFAULT_FIELD_MASK, 'nextPageToken'].join(','));
    expect(http.calls[0]!.url).not.toContain('FAKE_KEY');
    // The repeated place on page 2 is kept once.
    expect(job.items.map((p) => p.placeId.value)).toEqual([
      'ChIJ-fixture-gp-001',
      'ChIJ-fixture-gp-002',
      'ChIJ-fixture-gp-003',
    ]);
    expect(job.items[0]!.category?.value).toBe('Fabricant de produits alimentaires');
    expect(job.items[0]!.name.fetchedAt).toEqual(FIXED_NOW);
    // Pro mask: no phone or website requested.
    expect(job.items[0]!.phones).toEqual([]);
    expect(job.costs).toEqual([
      {
        provider: 'google',
        item: 'places-text-search-pro',
        units: 2,
        unitPriceUsd: 0.032,
        amountUsd: 0.064,
        kind: 'estimated',
      },
    ]);
  });

  it('stops at one page when a query wants 20 or fewer places', async () => {
    const http = pages();
    const provider = new GooglePlacesDiscovery({ apiKey: 'k', http });
    await provider.discoverCompanies({ ...query, maxPlaces: 20 });
    expect(http.calls).toHaveLength(1);
  });

  it('never plans more than 3 pages (60 results) per query', () => {
    const provider = new GooglePlacesDiscovery({ apiKey: 'k', http: fakeHttp([]) });
    expect(provider.estimate({ ...query, maxPlaces: 500 })[0]!.units).toBe(3);
  });

  it('prices the field mask by its most expensive field', () => {
    expect(skuForFieldMask(['places.id'])).toBe('essentials');
    expect(skuForFieldMask(DEFAULT_FIELD_MASK)).toBe('pro');
    expect(skuForFieldMask(ENTERPRISE_FIELD_MASK)).toBe('enterprise');
    expect(() => skuForFieldMask(['places.reviews'])).toThrow(/unpriced/);
    const enterprise = new GooglePlacesDiscovery({
      apiKey: 'k',
      fieldMask: ENTERPRISE_FIELD_MASK,
      http: fakeHttp([]),
    });
    expect(enterprise.estimate(query)[0]).toMatchObject({
      item: 'places-text-search-enterprise',
      unitPriceUsd: 0.035,
    });
  });

  it('has no run to collect', async () => {
    const provider = new GooglePlacesDiscovery({ apiKey: 'k', http: fakeHttp([]) });
    await expect(provider.collect({ actorId: 'a', runId: 'b', datasetId: 'c' })).rejects.toThrow(
      /synchronous/,
    );
  });
});

describe('LinkedIn people finders', () => {
  const people: PeopleQuery = {
    companyName: 'Huilerie El Fixture',
    companyLinkedinUrl: 'https://www.linkedin.com/company/huilerie-el-fixture/',
    titleKeywords: Array.from({ length: 60 }, (_, i) => `title ${i}`),
    location: 'Sfax, Tunisia',
    maxPeople: 25,
  };

  it('company employees: short mode, title and location filters (capped at 50 titles)', () => {
    const finder = new CompanyEmployeesFinder(new ApifyClient(TOKEN, fakeHttp([])));
    const input = finder.input(people);
    expect(input).toMatchObject({
      companies: [people.companyLinkedinUrl],
      profileScraperMode: 'Short ($4 per 1k)',
      locations: ['Sfax, Tunisia'],
      maxItems: 25,
    });
    expect(input.jobTitles).toHaveLength(50);
    expect(() => finder.input({ ...people, companyLinkedinUrl: null })).toThrow(/LinkedIn page/);
    expect(finder.estimate(people).reduce((s, c) => s + c.amountUsd, 0)).toBeCloseTo(
      0.02 + 25 * 0.003,
      6,
    );
  });

  it('maps profiles: French and English titles, end dates, dropped items', async () => {
    const http = fakeHttp([
      [/actor-runs\/fixtureEmployeesRun001/, fixture('apify-run-employees.json')],
      [/datasets\/fixtureEmployeesDataset001/, fixture('employees-dataset.json')],
    ]);
    const finder = new CompanyEmployeesFinder(new ApifyClient(TOKEN, http), clock);
    const job = succeeded(
      await finder.collect({
        actorId: COMPANY_EMPLOYEES_ACTOR,
        runId: 'fixtureEmployeesRun001',
        datasetId: 'fixtureEmployeesDataset001',
      }),
    );
    // The profile without a URL can't be cited and is dropped.
    expect(job.items.map((p) => p.fullName.value)).toEqual([
      'Salma Fixture',
      'Karim Testeur',
      'Nabil Ancien',
      'Ines Assistante',
      'Mehdi Commercial',
    ]);
    const [salma, karim, nabil] = job.items;
    expect(salma!.via).toBe('company_employees');
    expect(salma!.linkedinUrl).toEqual({
      value: 'https://www.linkedin.com/in/salma-fixture-logistique',
      sourceUrl: 'https://www.linkedin.com/in/salma-fixture-logistique',
      fetchedAt: FIXED_NOW,
      kind: 'fact',
    });
    expect(salma!.location?.value).toBe('Sfax, Tunisia');
    expect(salma!.positions).toEqual([
      {
        title: 'Directrice Logistique',
        companyName: 'Huilerie El Fixture',
        companyLinkedinUrl: 'https://www.linkedin.com/company/huilerie-el-fixture/',
        startDate: null,
        endDate: null,
      },
    ]);
    expect(karim!.positions.map((p) => [p.title, p.startDate, p.endDate])).toEqual([
      ['Supply Chain Manager', 'Mar 2022', null],
      ['Acheteur', '2018', '2022'],
    ]);
    expect(nabil!.positions[0]!.endDate).toBe('2024-06');
    expect(job.costs.map((c) => [c.item, c.amountUsd])).toEqual([
      [`${COMPANY_EMPLOYEES_ACTOR}#actor-start`, 0.02],
      [`${COMPANY_EMPLOYEES_ACTOR}#short-profile`, 0.018],
    ]);
  });

  it('falls back to profile search when the company has no LinkedIn page', async () => {
    const http = fakeHttp([
      [/acts\/harvestapi~linkedin-profile-search\/runs/, started('fixtureSearchRun001', 'ds')],
      [/actor-runs\/fixtureSearchRun001/, fixture('apify-run-profile-search.json')],
      [/datasets\/fixtureSearchDataset001/, fixture('profile-search-dataset.json')],
    ]);
    const client = new ApifyClient(TOKEN, http);
    const finder = new LinkedinPeopleFinder(
      new CompanyEmployeesFinder(client, clock),
      new ProfileSearchFinder(client, clock),
    );
    const noPage = { ...people, companyName: 'Textiles Fixture Sud', companyLinkedinUrl: null };
    const job = await finder.findPeople(noPage);
    expect(job.state).toBe('started');
    expect(http.calls[0]!.url).toContain('harvestapi~linkedin-profile-search');
    expect(http.calls[0]!.options.body).toMatchObject({
      searchQuery: 'Textiles Fixture Sud',
      profileScraperMode: 'Short',
      locations: ['Sfax, Tunisia'],
    });
    expect(finder.estimate(noPage)).toEqual([
      expect.objectContaining({ item: `${PROFILE_SEARCH_ACTOR}#search-page`, units: 1 }),
    ]);
    const result = succeeded(
      await finder.collect({
        actorId: PROFILE_SEARCH_ACTOR,
        runId: 'fixtureSearchRun001',
        datasetId: 'fixtureSearchDataset001',
      }),
    );
    expect(result.items.map((p) => [p.fullName.value, p.via])).toEqual([
      ['Héla Fixture', 'profile_search'],
      ['Omar Ailleurs', 'profile_search'],
    ]);
  });
});

describe('EmailFinderVerifier', () => {
  it('sends one "Name, domain" line per lookup', () => {
    expect(
      leadLine({ firstName: 'Salma', lastName: 'Fix, ture', domain: 'https://www.acme.example/' }),
    ).toBe('Salma Fix ture, acme.example');
  });

  it('maps verified, catch-all and missing emails; found emails are estimates', async () => {
    const http = fakeHttp([
      [/actor-runs\/fixtureEmailRun001/, fixture('apify-run-emails.json')],
      [/datasets\/fixtureEmailDataset001/, fixture('emails-dataset.json')],
    ]);
    const finder = new EmailFinderVerifier(new ApifyClient(TOKEN, http), clock);
    const job = succeeded(
      await finder.collect({
        actorId: EMAIL_FINDER_ACTOR,
        runId: 'fixtureEmailRun001',
        datasetId: 'fixtureEmailDataset001',
      }),
    );
    const byKey = new Map(job.items.map((e) => [e.key, e]));
    const salma = byKey.get(emailLookupKey('Salma', 'Fixture', 'huilerie-elfixture.example'))!;
    expect(salma.status).toBe('valid');
    expect(salma.email).toEqual({
      value: 'salma.fixture@huilerie-elfixture.example',
      sourceUrl: 'https://console.apify.com/view/runs/fixtureEmailRun001',
      fetchedAt: FIXED_NOW,
      kind: 'estimate',
    });
    expect(
      byKey.get(emailLookupKey('Karim', 'Testeur', 'huilerie-elfixture.example')),
    ).toMatchObject({
      status: 'catch_all',
      rawStatus: 'catch_all',
    });
    expect(byKey.get(emailLookupKey('Mehdi', 'Commercial', 'huilerie-elfixture.example'))).toEqual({
      key: emailLookupKey('Mehdi', 'Commercial', 'huilerie-elfixture.example'),
      email: null,
      status: 'not_found',
      rawStatus: 'unknown',
    });
    // Only the verified find is charged.
    expect(job.costs).toEqual([
      expect.objectContaining({ item: `${EMAIL_FINDER_ACTOR}#email-found-verified`, units: 1 }),
    ]);
  });

  it('makes no call for an empty batch', async () => {
    const http = fakeHttp([]);
    const job = await new EmailFinderVerifier(new ApifyClient(TOKEN, http)).findEmails([]);
    expect(job.state).toBe('succeeded');
    expect(http.calls).toHaveLength(0);
  });
});

describe('costsFromUsage', () => {
  it('refuses to price an unknown event at zero', () => {
    expect(() =>
      costsFromUsage({
        ref: { actorId: 'someone/else', runId: 'r', datasetId: 'd' },
        status: 'SUCCEEDED',
        usage: { chargedEventCounts: { mystery: 3 }, usageTotalUsd: null, restarts: 0 },
        reportedPrices: {},
      }),
    ).toThrow(/No price/);
  });
});

describe('thumbnails and photos', () => {
  const place = { placeId: 'p1', title: 'Huilerie', url: 'https://maps.example/p1' };
  it('keeps the Maps photo address when the Actor returns one, and only an http(s) one', () => {
    const [ok] = mapPlaces([{ ...place, imageUrl: 'https://lh3.example/photo.jpg' }], FIXED_NOW);
    expect(ok!.imageUrl).toBe('https://lh3.example/photo.jpg');
    const [none] = mapPlaces([place], FIXED_NOW);
    expect(none!.imageUrl).toBeNull();
    const [bad] = mapPlaces([{ ...place, imageUrl: 'javascript:alert(1)' }], FIXED_NOW);
    expect(bad!.imageUrl).toBeNull();
  });

  it('keeps a profile photo address only when the provider returned one', () => {
    const base = { linkedinUrl: 'https://www.linkedin.com/in/amel-ben', fullName: 'Amel Ben' };
    const photoOf = (extra: object) =>
      mapPeople([{ ...base, ...extra }], 'company_employees', FIXED_NOW)[0]!.photoUrl;
    expect(photoOf({ photo: 'https://media.example/a.jpg' })).toBe('https://media.example/a.jpg');
    expect(photoOf({ photo: { url: 'https://media.example/b.jpg' } })).toBe(
      'https://media.example/b.jpg',
    );
    expect(photoOf({ pictureUrl: 'https://media.example/c.jpg' })).toBe(
      'https://media.example/c.jpg',
    );
    expect(photoOf({})).toBeNull();
    expect(photoOf({ photo: 'data:image/png;base64,AAAA' })).toBeNull();
  });
});
