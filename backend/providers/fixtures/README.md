# Provider fixtures

Responses used by the provider and stage tests in place of real API calls. No test calls Apify,
Google or an LLM.

**These are synthetic, not recordings.** No paid run has been made yet, so each file is built
by hand from the provider's documented schema (Actor input-schema and sample-output pages,
Google's REST reference, checked 2026-10-17). Every company, person, domain and number in them
is made up: domains use the reserved `.example` TLD and phone numbers are fictitious. Replace
them with real recorded responses from the pass 7 pilot, and re-run the tests: any field-name
difference from the docs will show up there first.

Unverified against a real response:

- Short-mode profile fields of both harvestapi Actors (no published sample). The mapper accepts
  the full-mode names (`linkedinUrl`, `firstName`, `lastName`, `headline`, `currentPosition`,
  `experience`) and common alternatives.
- Whether the Maps Actor puts website emails at the top level (`emails`) or under
  `contactDetails`. The mapper reads both.
- The shape of LinkedIn experience dates (string or `{ text, year, month }`). The mapper reads
  both, and "Present" or an absent end date means current.

| File                                      | Stands for                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `google-places-page1.json`, `-page2.json` | Text Search (New) pages, Pro field mask, page 1 has a `nextPageToken`    |
| `apify-run-*.json`                        | `GET /v2/actor-runs/{id}` responses (status, dataset ID, charged events) |
| `maps-dataset.json`                       | compass/crawler-google-places items with contact enrichment              |
| `employees-dataset.json`                  | harvestapi/linkedin-company-employees items                              |
| `profile-search-dataset.json`             | harvestapi/linkedin-profile-search items                                 |
| `emails-dataset.json`                     | crustapi/email-finder-verifier items                                     |
