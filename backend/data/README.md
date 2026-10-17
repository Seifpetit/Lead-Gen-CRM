# backend/data

Data-access layer: migrations and one module per entity. The only folder that may import the
database driver (enforced by ESLint).

## Rules

- **User scoping.** Every function on a user-owned table takes a `UserId` (a branded type
  from `ids.ts`). A plain string does not type-check, so a query cannot be written without it.
  `regions` (reference data) and `suppression_list` (global, see below) are the exceptions.
- **Evidence.** Company and contact writes only accept `Sourced<T>` values (value, source URL,
  fetched-at time, fact or estimate). Each value is written together with its `evidence` row in
  one transaction; a value with a missing or invalid source rejects the whole write.
- **Company dedupe** (per user): Google place ID, then normalized domain, then normalized name
  plus governorate. Names drop accents, punctuation and the legal forms SARL, SUARL, SA, SAS,
  Ste and Société. Social and webmail hosts (Facebook, Instagram, Gmail, ...) never count as a
  domain. A name match is skipped when both sides have a different place ID or domain, so
  branches that share a name stay separate. On a match, newer values replace older ones;
  identifiers only fill in when empty.
- **Contact dedupe** on LinkedIn public ID (case-insensitive). Contacts without one are not
  deduplicated yet.
- **Suppression** is global: an objection recorded by any user blocks the email, phone (any
  format) or LinkedIn ID for everyone. Every contact write checks it, including an update to a
  contact whose stored email or phone was suppressed later, and raises `SuppressedContactError`.
- **Run steps** store the Apify run and dataset IDs (`recordApifyStart`) before any waiting. A
  step can only be started once, and the database rejects an Apify step past `pending` without
  both IDs. `(run, stage, step_key)` is unique, so a unit of work is never planned twice.
- **Region cells** split each region into map rectangles (`createRegionGrid`); a dense cell is
  split further with `splitCell`, and `listCells(..., { leafOnly: true })` gives the cells to
  search. Cells are shared geometry, not user data. No real governorate bounds are seeded yet.
- **Coverage** is stored per user and cell as counts (places, qualified, with decision-maker,
  with channel, leads, spend), added to after each run. Shares and cost per lead are derived
  from the counts; `listCoverage` rolls cells up per region (the `region_coverage_rollup` view).
- **Search queries** log every search: wording, cell, provider, requests, results, new places,
  cost, run. `queryYieldForCell` groups them by normalized wording, and `lastNewPlacesFound = 0`
  marks a wording that has stopped finding anything new in that cell.
- **Provider refresh**: companies carry `source_provider` and `refresh_by` (metadata, not
  evidence). `listCompaniesDueForRefresh` returns the rows whose provider content must be
  refreshed or dropped.
- **CRM leads** are unique per user, company and contact, and an upsert never changes the
  stage, so a dismissed or opted-out lead never comes back as new.

## Commands

```sh
npm run db:migrate    # apply pending migrations and seed regions
npm run db:rollback   # undo the latest migration
npm run db:seed       # regions plus a placeholder demo user, company, contact and lead
```
