// Provider prices used for cost estimates before and after a call. Checked on the provider
// pages on 2026-10-17. Apify prices are the FREE/BRONZE tier (the highest); a paid Apify plan
// pays less, so estimates err high. Reconcile against the Apify and Google bills.

export const PRICES_CHECKED_ON = '2026-10-17';

/** USD per pay-per-event charge, by Actor and event name. */
export const APIFY_EVENT_PRICES: Record<string, Record<string, number>> = {
  // https://apify.com/compass/crawler-google-places (pricing version 2026-04-29)
  'compass/crawler-google-places': {
    'apify-actor-start': 0.00005, // per GB of run memory
    'place-scraped': 0.004,
    'contact-details-scraped': 0.002,
    'place-details-scraped': 0.002,
    'filter-applied': 0.001,
  },
  // https://apify.com/harvestapi/linkedin-company-employees (pricing from 2026-04-13)
  'harvestapi/linkedin-company-employees': {
    'actor-start': 0.02,
    'short-profile': 0.003,
    'full-profile': 0.008,
    'full-profile-with-email': 0.012,
  },
  // https://apify.com/harvestapi/linkedin-profile-search (pricing from 2026-02-05)
  'harvestapi/linkedin-profile-search': {
    'search-page': 0.1, // up to 25 short profiles per page
    'full-profile': 0.004,
    'full-profile-with-email': 0.01,
  },
  // https://apify.com/crustapi/email-finder-verifier (pricing from 2026-06-22).
  // Catch-all and unknown results are not charged.
  'crustapi/email-finder-verifier': {
    'email-found-verified': 0.005,
    'email-verified-list': 0.002,
  },
};

/** Run memory assumed when estimating per-GB start events. */
export const APIFY_ESTIMATE_MEMORY_GB = 4;

// https://developers.google.com/maps/billing-and-pricing/pricing (0-100k requests/month tier).
// The most expensive field in the field mask decides the SKU of every page request.
export type PlacesTextSearchSku = 'essentials' | 'pro' | 'enterprise' | 'enterprise_atmosphere';

export const GOOGLE_TEXT_SEARCH_PRICE_PER_REQUEST: Record<PlacesTextSearchSku, number> = {
  essentials: 0, // IDs only: no charge
  pro: 0.032,
  enterprise: 0.035,
  enterprise_atmosphere: 0.04,
};

/** Free requests per month per SKU. Not subtracted in estimates (they're per billing account). */
export const GOOGLE_TEXT_SEARCH_FREE_PER_MONTH: Record<PlacesTextSearchSku, number> = {
  essentials: Infinity,
  pro: 5000,
  enterprise: 1000,
  enterprise_atmosphere: 1000,
};

/**
 * Lowest max-cost (maxTotalChargeUsd) each Actor accepts, from its pricing info
 * (minimalMaxTotalChargeUsd). A step whose remaining budget is below this can't be capped and
 * is not started.
 */
export const APIFY_MIN_MAX_CHARGE_USD: Record<string, number> = {
  'compass/crawler-google-places': 0.5,
  'harvestapi/linkedin-company-employees': 0.05,
  'harvestapi/linkedin-profile-search': 0.1,
  'crustapi/email-finder-verifier': 0,
};
