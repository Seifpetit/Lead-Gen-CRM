import { APIFY_ESTIMATE_MEMORY_GB } from '../config/pricing.js';
import type { CostEntry } from '../lib/cost.js';
import { ApifyClient, collectApifyRun, estimateEvent } from './apify.js';
import type { Clock } from './http.js';
import { fetchedAtOf, httpUrl, sourced, strings, text, unique } from './sourcing.js';
import type {
  ApifyRunRef,
  CompanyDiscovery,
  DiscoveredPlace,
  DiscoveryQuery,
  ProviderJob,
  RunOptions,
} from './types.js';

export const GOOGLE_MAPS_ACTOR = 'compass/crawler-google-places';

/** The dataset fields this adapter reads (others are ignored). */
export interface MapsItem {
  placeId?: string;
  title?: string;
  address?: string;
  categoryName?: string;
  categories?: string[];
  website?: string;
  phone?: string;
  phoneUnformatted?: string;
  emails?: string[];
  linkedIns?: string[];
  contactDetails?: { emails?: string[]; linkedIns?: string[] };
  location?: { lat?: number; lng?: number };
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  reviewsCount?: number;
  url?: string;
  scrapedAt?: string;
}

/** Actor input for one query: one wording, restricted to the cell's rectangle. */
export function mapsInput(q: DiscoveryQuery) {
  const { south: s, west: w, north: n, east: e } = q.bounds;
  return {
    searchStringsArray: [q.textQuery],
    customGeolocation: {
      type: 'Polygon',
      // GeoJSON: [lng, lat], closed ring.
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
    language: q.languageCode,
    maxCrawledPlacesPerSearch: q.maxPlaces,
    // Emails and social links from each place's website (the "contact-details-scraped" event).
    scrapeContacts: true,
    // Closed places are billed like open ones and are never leads.
    skipClosedPlaces: true,
  };
}

export function mapPlaces(items: MapsItem[], readAt: Date): DiscoveredPlace[] {
  const places: DiscoveredPlace[] = [];
  for (const item of items) {
    const placeId = text(item.placeId);
    const name = text(item.title);
    const mapsUrl = httpUrl(item.url);
    // Without an ID, a name and a page to cite, the place can't be stored.
    if (!placeId || !name || !mapsUrl) continue;
    const at = fetchedAtOf(item.scrapedAt, readAt);
    const website = httpUrl(item.website);
    const fact = (v: string | null) => sourced(v, mapsUrl, at, 'fact');
    // Emails and LinkedIn links were read from the company's website, so cite it.
    const siteSource = website ?? mapsUrl;
    const emails = unique([...strings(item.emails), ...strings(item.contactDetails?.emails)]);
    const linkedin = [...strings(item.linkedIns), ...strings(item.contactDetails?.linkedIns)].find(
      (u) => /linkedin\.com\/company\//i.test(u),
    );
    const phone = text(item.phoneUnformatted) ?? text(item.phone);
    const lat = item.location?.lat;
    const lng = item.location?.lng;
    places.push({
      provider: 'apify_google_maps',
      placeId: fact(placeId)!,
      name: fact(name)!,
      address: fact(text(item.address)),
      category: fact(text(item.categoryName)),
      types: strings(item.categories),
      website: fact(website),
      phones: phone ? [fact(phone)!] : [],
      emails: emails.map((e) => sourced(e.toLowerCase(), siteSource, at, 'fact')!),
      linkedinUrl: sourced(linkedin ?? null, siteSource, at, 'fact'),
      location: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
      businessStatus: item.permanentlyClosed
        ? 'CLOSED_PERMANENTLY'
        : item.temporarilyClosed
          ? 'CLOSED_TEMPORARILY'
          : 'OPERATIONAL',
      reviewsCount: typeof item.reviewsCount === 'number' ? item.reviewsCount : null,
      mapsUrl,
    });
  }
  return places;
}

/** Google Maps Scraper Actor with website contact enrichment. */
export class GoogleMapsApifyDiscovery implements CompanyDiscovery {
  readonly name = GOOGLE_MAPS_ACTOR;

  constructor(
    private readonly client: ApifyClient,
    private readonly now: Clock = () => new Date(),
  ) {}

  estimate(q: DiscoveryQuery): CostEntry[] {
    return [
      estimateEvent(GOOGLE_MAPS_ACTOR, 'apify-actor-start', APIFY_ESTIMATE_MEMORY_GB),
      estimateEvent(GOOGLE_MAPS_ACTOR, 'place-scraped', q.maxPlaces),
      estimateEvent(GOOGLE_MAPS_ACTOR, 'contact-details-scraped', q.maxPlaces),
    ];
  }

  async discoverCompanies(
    q: DiscoveryQuery,
    options?: RunOptions,
  ): Promise<ProviderJob<DiscoveredPlace>> {
    const run = await this.client.startRun(GOOGLE_MAPS_ACTOR, mapsInput(q), options);
    return { state: 'started', run: run.ref, costs: [] };
  }

  collect(ref: ApifyRunRef): Promise<ProviderJob<DiscoveredPlace>> {
    return collectApifyRun<MapsItem, DiscoveredPlace>(this.client, ref, (items) =>
      mapPlaces(items, this.now()),
    );
  }
}
