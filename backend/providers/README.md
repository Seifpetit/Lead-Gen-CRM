# backend/providers

Provider adapters, one interface per stage (`types.ts`):

| Stage             | Interface          | Adapters                                                                                                                                                                                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| discoverCompanies | `CompanyDiscovery` | `GoogleMapsApifyDiscovery` (compass/crawler-google-places), `GooglePlacesDiscovery` (Places API Text Search)                                                                                                                    |
| findPeople        | `PeopleFinder`     | `CompanyEmployeesFinder` (harvestapi/linkedin-company-employees), `ProfileSearchFinder` (harvestapi/linkedin-profile-search), `LinkedinPeopleFinder` (employees when the company has a LinkedIn page, profile search otherwise) |
| findEmails        | `EmailFinder`      | `EmailFinderVerifier` (crustapi/email-finder-verifier)                                                                                                                                                                          |

## Claude classifier (`anthropicClassifier.ts`)

`AnthropicClassifier` implements `CompanyClassifier` and `TitleClassifier` (`stages/classifier.ts`)
with the Anthropic Messages API over the same `HttpJson` layer as the other adapters (plain
`fetch`, no SDK). It exists only when `ANTHROPIC_API_KEY` is set (`createClassifier`, wired in
`backend/index.ts`); without a key everything behaves as before and undecided items go to review.

- **When it is called.** Only after the rules cannot decide a company or a title, and only while
  the run's classifier spend is under `CLASSIFIER_RUN_CAP_USD` (default $0.50, summed from the
  ledger's `anthropic` rows). Past the cap, undecided items go to review with that reason.
- **What it sees.** Company: name, category, types, website and the sector candidates (the sector
  that found the place first). No address, no people. Title: the job title text only. The facts
  are marked untrusted in the prompt.
- **What it returns.** Strict JSON `{ verdict, reasons[] }` (plus `fields`, the facts it relied
  on), validated with zod. A code fence around the JSON is the only leniency. Any HTTP error,
  timeout (15 s), network failure or unreadable answer gives `review` for a company and no role
  for a title, never `qualified`. Results are `estimate`s, carry the model name, and the runner
  stores the facts it relied on plus its verdict as `classifier_*` evidence rows on the company.
- **Cost.** Each call returns two `anthropic` cost entries (input and output tokens) from the
  API's `usage`, priced with `ANTHROPIC_PRICES_PER_MTOK` in `config/pricing.ts`. An unreadable
  answer is still billed. If `usage` is missing, a high guess is used, never zero. An unlisted
  model is priced at the dearest known row. **The price table has not been checked against
  Anthropic's pricing page; confirm it before the pilot.** Rows go to `cost_ledger` as `actual`
  and count against the run cap and the month cap like any other spend.
- **Secrets.** The key goes in the `x-api-key` header. The classifier never logs, and a failure
  keeps only its kind (`timeout`, `http 529`, `network error`, `invalid answer`), not the
  message, the prompt or the answer.
- **Tests** use a fake `HttpJson`: valid and fenced JSON, invalid JSON, a wrong verdict, a
  timeout, an HTTP error, missing usage, the run spend cap and no key.

Rules:

- **No database.** Adapters return values; the runner persists them. Lint refuses a `data/` or
  driver import here (`backend/test/dbBoundary.test.ts`).
- **Start and read only.** An Apify adapter's `find*`/`discover*` starts a run and returns its
  run and dataset IDs straight away (`state: 'started'`), so the runner can store them before
  waiting. `collect(run)` reads the run's status and charged events and, once it has succeeded,
  its dataset. The Apify client has no wait, abort or resurrect calls. Google Places is
  synchronous and returns `succeeded` at once.
- **Sourced values.** Every value is `Sourced<T>`: the Maps or LinkedIn page it was read from
  (website emails cite the website), a read time, and `fact` or `estimate`. A found email is
  always an estimate and cites the Apify run. Items without an ID, a name or a citable URL are
  dropped, never filled in.
- **Costs.** Every call returns `CostEntry` rows (provider, item, units, unit price, amount,
  `estimated`) ready for `cost_ledger`. Apify costs come from the run's `chargedEventCounts`
  priced with `config/pricing.ts`; an unpriced event throws instead of counting as free.
  `estimate()` prices a call before it is made. `maxTotalChargeUsd` is passed to Apify when the
  runner sets it.
- **Secrets.** The Apify token goes in the `Authorization` header and the Google key in
  `X-Goog-Api-Key`, never in a URL, so `HttpError` messages can't leak them.
- **Tests** use `fixtures/` through a fake HTTP layer and stub `fetch` to throw. See
  `fixtures/README.md`: the fixtures are built from the documented schemas, not recorded.

## Checked against the provider docs (2026-10-17)

Differences from the plan doc and things to know before the pilot. Prices are the Apify
FREE/BRONZE tier, the highest; a paid plan pays less.

**compass/crawler-google-places**

- "Website contacts" is `scrapeContacts: true`. It is billed as a separate event,
  `contact-details-scraped` ($0.002 per place), on top of `place-scraped` ($0.004 per place),
  so enriched discovery costs about $6 per 1,000 places, not the "$1.50 / 1,000" the Actor page
  headline suggests (that is the top-tier price without add-ons).
- The Actor page shows two price versions for `place-scraped` ($0.004 and $0.003 at
  FREE/BRONZE). I used the newer, higher one. Check the price on the first real run.
- There is no max-cost input field. The cap is Apify's run option `maxTotalChargeUsd`
  (minimum $0.50 for this Actor), which the adapter passes through.
- A cell is passed as `customGeolocation` (a GeoJSON polygon, `[lng, lat]`), which overrides
  `locationQuery`. `skipClosedPlaces: true` avoids paying for closed places.

**harvestapi/linkedin-company-employees**

- Short mode is the literal enum value `"Short ($4 per 1k)"`; it bills `short-profile` at
  $0.003 per profile, plus `actor-start` at $0.02 per run (per company in `one_by_one` batch
  mode).
- Filters: `jobTitles` (max 50) and `locations` (full names, "Tunisia" not "TN").
- No sample of Short-mode output is published, so the mapper also accepts alternative field
  names. Confirm on the first real run.

**harvestapi/linkedin-profile-search**

- Billed per search page (`search-page`, $0.10 for up to 25 short profiles), not per profile.
- Its company filter (`currentCompanies`) takes LinkedIn company URLs, which is exactly what
  the fallback case lacks. The adapter searches by company name (`searchQuery`) with title and
  location filters, and `verifyCurrentRole` drops people whose current employer doesn't match.
  Expect lower precision than the employees Actor.
- Short mode here is the plain value `"Short"`.

**crustapi/email-finder-verifier**

- Input is a list of `"First Last, domain"` lines (`leads`), not separate name and domain fields.
- `emailStatus` is `verified | invalid | catch_all | unknown` (mapped to
  `valid | invalid | catch_all | unknown`; no email returned maps to `not_found`).
- $0.005 per verified find; catch-all and unknown results are free.

**Google Places API (New) Text Search**

- `pageSize` max 20, at most 60 results per query across pages; a `pageToken` request must
  repeat the first request's parameters exactly.
- The field mask is required. Requesting phone, website or rating moves every page request
  from Pro ($32 per 1,000, 5,000 free a month) to Enterprise ($35 per 1,000, 1,000 free a
  month). The default mask (`DEFAULT_FIELD_MASK`) is Pro and has no phone or website; the
  Maps Actor supplies those. `ENTERPRISE_FIELD_MASK` adds them, and any field not in the
  price table is refused.
- Free monthly requests aren't subtracted from estimates (they are per billing account).
- Google's terms limit how long most Places content may be stored; the place ID may be kept.
  Companies carry `source_provider` and `refresh_by` for this (pass 1). Setting `refresh_by`
  is the runner's job (pass 4).
