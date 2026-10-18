import {
  GOOGLE_TEXT_SEARCH_PRICE_PER_REQUEST,
  type PlacesTextSearchSku,
} from '../config/pricing.js';
import { costEntry, type CostEntry } from '../lib/cost.js';
import { defaultHttp, type Clock, type HttpJson } from './http.js';
import { httpUrl, sourced, text } from './sourcing.js';
import type {
  ApifyRunRef,
  CompanyDiscovery,
  DiscoveredPlace,
  DiscoveryQuery,
  ProviderJob,
} from './types.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
/** Text Search returns 20 per page and at most 60 per query across pages. */
export const PAGE_SIZE = 20;
export const MAX_RESULTS_PER_QUERY = 60;

// Field -> the SKU it puts a request in. A field not listed here is refused, so nobody adds an
// expensive field to the mask without seeing what it costs.
const FIELD_SKUS: Record<string, PlacesTextSearchSku> = {
  'places.id': 'essentials',
  'places.name': 'essentials',
  'places.attributions': 'essentials',
  'places.displayName': 'pro',
  'places.formattedAddress': 'pro',
  'places.location': 'pro',
  'places.types': 'pro',
  'places.primaryType': 'pro',
  'places.primaryTypeDisplayName': 'pro',
  'places.businessStatus': 'pro',
  'places.googleMapsUri': 'pro',
  'places.nationalPhoneNumber': 'enterprise',
  'places.internationalPhoneNumber': 'enterprise',
  'places.websiteUri': 'enterprise',
  'places.userRatingCount': 'enterprise',
  'places.rating': 'enterprise',
};
const SKU_ORDER: PlacesTextSearchSku[] = [
  'essentials',
  'pro',
  'enterprise',
  'enterprise_atmosphere',
];

/** Pro tier: enough to dedupe, qualify and cite a place. No phone or website. */
export const DEFAULT_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
  'places.googleMapsUri',
] as const;

/** Adds phone, website and review count: every page request becomes Enterprise. */
export const ENTERPRISE_FIELD_MASK = [
  ...DEFAULT_FIELD_MASK,
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.userRatingCount',
] as const;

/** The SKU a field mask bills at: the most expensive field wins. */
export function skuForFieldMask(fields: readonly string[]): PlacesTextSearchSku {
  let sku: PlacesTextSearchSku = 'essentials';
  for (const f of fields) {
    const s = FIELD_SKUS[f];
    if (!s) throw new Error(`Unknown or unpriced Places field "${f}"; add it to FIELD_SKUS`);
    if (SKU_ORDER.indexOf(s) > SKU_ORDER.indexOf(sku)) sku = s;
  }
  return sku;
}

interface PlacesResponse {
  places?: {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    types?: string[];
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    businessStatus?: string;
    googleMapsUri?: string;
    internationalPhoneNumber?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    userRatingCount?: number;
  }[];
  nextPageToken?: string;
}

export interface GooglePlacesOptions {
  apiKey: string;
  fieldMask?: readonly string[];
  http?: HttpJson;
  now?: Clock;
}

/**
 * Places API (New) Text Search, restricted to the query's rectangle, French, Tunisia.
 * Synchronous: discoverCompanies pages through the results and returns them at once.
 */
export class GooglePlacesDiscovery implements CompanyDiscovery {
  readonly name = 'google-places-text-search';
  private readonly fieldMask: readonly string[];
  private readonly sku: PlacesTextSearchSku;
  private readonly http: HttpJson;
  private readonly now: Clock;

  constructor(private readonly options: GooglePlacesOptions) {
    if (options.apiKey.trim() === '') throw new Error('Google Places API key is missing');
    this.fieldMask = options.fieldMask ?? DEFAULT_FIELD_MASK;
    if (!this.fieldMask.includes('places.id')) throw new Error('Field mask must include places.id');
    this.sku = skuForFieldMask(this.fieldMask);
    this.http = options.http ?? defaultHttp;
    this.now = options.now ?? (() => new Date());
  }

  private pagesFor(q: DiscoveryQuery): number {
    return Math.max(1, Math.ceil(Math.min(q.maxPlaces, MAX_RESULTS_PER_QUERY) / PAGE_SIZE));
  }

  private requestCost(requests: number): CostEntry {
    return costEntry(
      'google',
      `places-text-search-${this.sku}`,
      requests,
      GOOGLE_TEXT_SEARCH_PRICE_PER_REQUEST[this.sku],
    );
  }

  estimate(q: DiscoveryQuery): CostEntry[] {
    return [this.requestCost(this.pagesFor(q))];
  }

  async discoverCompanies(q: DiscoveryQuery): Promise<ProviderJob<DiscoveredPlace>> {
    const { south, west, north, east } = q.bounds;
    // Every page request repeats the same body; only pageToken changes.
    const body = {
      textQuery: q.textQuery,
      languageCode: q.languageCode,
      regionCode: 'TN',
      pageSize: PAGE_SIZE,
      locationRestriction: {
        rectangle: {
          low: { latitude: south, longitude: west },
          high: { latitude: north, longitude: east },
        },
      },
    };
    const headers = {
      'X-Goog-Api-Key': this.options.apiKey,
      'X-Goog-FieldMask': [...this.fieldMask, 'nextPageToken'].join(','),
    };
    const places: DiscoveredPlace[] = [];
    const seen = new Set<string>();
    let requests = 0;
    let pageToken: string | undefined;
    const limit = Math.min(q.maxPlaces, MAX_RESULTS_PER_QUERY);
    for (let page = 0; page < this.pagesFor(q); page++) {
      const res = await this.http<PlacesResponse>(ENDPOINT, {
        method: 'POST',
        headers,
        body: pageToken ? { ...body, pageToken } : body,
      });
      requests++;
      const readAt = this.now();
      for (const p of res.places ?? []) {
        const place = toPlace(p, readAt);
        if (place && !seen.has(place.placeId.value) && places.length < limit) {
          seen.add(place.placeId.value);
          places.push(place);
        }
      }
      pageToken = text(res.nextPageToken) ?? undefined;
      if (!pageToken || places.length >= limit) break;
    }
    return {
      state: 'succeeded',
      run: null,
      items: places,
      costs: [this.requestCost(requests)],
      usage: null,
    };
  }

  collect(_run: ApifyRunRef): Promise<ProviderJob<DiscoveredPlace>> {
    return Promise.reject(new Error('Google Places is synchronous: there is no run to collect'));
  }
}

function toPlace(
  p: NonNullable<PlacesResponse['places']>[number],
  at: Date,
): DiscoveredPlace | null {
  const id = text(p.id);
  const name = text(p.displayName?.text);
  if (!id || !name) return null;
  // The Maps page is the citable source for every field Google returns.
  const mapsUrl =
    httpUrl(p.googleMapsUri) ??
    `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`;
  const fact = (v: string | null) => sourced(v, mapsUrl, at, 'fact');
  const phone = text(p.internationalPhoneNumber) ?? text(p.nationalPhoneNumber);
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  return {
    provider: 'google_places',
    placeId: fact(id)!,
    name: fact(name)!,
    address: fact(text(p.formattedAddress)),
    category: fact(text(p.primaryTypeDisplayName?.text) ?? text(p.primaryType)),
    types: p.types ?? [],
    website: fact(httpUrl(p.websiteUri)),
    phones: phone ? [fact(phone)!] : [],
    emails: [],
    linkedinUrl: null,
    location: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
    businessStatus: text(p.businessStatus),
    reviewsCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    mapsUrl,
  };
}
