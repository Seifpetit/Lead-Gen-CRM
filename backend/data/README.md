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
  search. Cells are shared geometry, not user data. Only cells that intersect the region's outline are
  created. `regions.outline` (GeoJSON) and `bounds_source` (`osm` or `manual`) come from migration
  004; the seed applies the committed OSM bounds and outlines except over manual bounds.
- **Coverage** is stored per user and cell as counts (places, qualified, with decision-maker,
  with channel, leads), added to after each run. Shares are derived from the counts; `listCoverage` rolls cells up per region (the `region_coverage_rollup` view).
- **Search queries** log every search: wording, cell, provider, requests, results, new places,
  cost, run. `queryYieldForCell` groups them by normalized wording, and `lastNewPlacesFound = 0`
  marks a wording that has stopped finding anything new in that cell.
- **Provider refresh**: companies carry `source_provider` and `refresh_by` (metadata, not
  evidence). `listCompaniesDueForRefresh` returns the rows whose provider content must be
  refreshed or dropped.
- **Cost ledger** (`cost_ledger`) is the only record of spend. Rows are append-only (a trigger
  refuses UPDATE and DELETE); `correctCost` adds one opposite row, and `reconcileCost` corrects an
  estimate and adds the actual. `amount_usd` must equal `units * unit_price_usd`. Run spend, step
  cost, monthly spend (UTC month of the row) and cost per lead (run, region, cell) are all
  computed from it; nothing stores a running total.
- **Budgets**: every run has `budget_cap_usd`, and `user_budget` holds an optional monthly cap.
  `recordCost` locks the run and, in the same transaction, sets it to `stopped_by_cap` once
  either cap is reached. Costs after a stop are still recorded. `remainingBudget` is what the
  orchestrator checks before starting a paid step.
- **Run attribution**: companies, contacts and CRM leads keep the `run_id` that first produced
  them (a later run that finds them again does not overwrite it); companies also keep their
  `region_cell_id`, which is how cost per lead is computed per cell.
- **Board pictures** (migration 010): `companies.image_url`, `image_source` (`og` for the website's
  og:image or twitter:image, `maps` for the Maps photo) and `image_checked_at`, and
  `contacts.photo_url` when the provider returned one. Only the address is stored, never the file.
  `companyImages.ts` sets the Maps photo when a company is first found, lists companies still to be
  looked up, and `finishImageLookup` records the result (a website image replaces the Maps one).
- **Company notes and stage history** (migration 011): `companies.notes` holds the free text from the
  company page (up to 5000 characters). `crm_card_events` records each card's creation and every stage
  change (`from_stage` null for creation) with its time; a trigger on `crm_cards` writes them, so every
  code path that moves a card is covered and the existing cards got one backfilled event each.
- **CRM boards**: `listCards` and `loadBoard` page every column with a keyset cursor over
  `(sort key, id)`, so a page boundary is exact even when many cards tie. Search, sector, minimum
  score and sort are applied in SQL; each column's `total` counts what matches the filters.
  Every card also carries `foundAt` (when the company or person was first found), `runId` and
  `leadId` (the run and scored lead that first produced the company, which the card opens), so the
  dashboard can filter by found-in window, run and region. `loadFacets` counts the cards per stage,
  sector and run for the dashboard's folders.
- **CRM leads** are unique per user, company and contact, and an upsert never changes the
  stage, so a dismissed or opted-out lead never comes back as new.

## Commands

```sh
npm run db:migrate    # apply pending migrations and seed regions
npm run db:rollback   # undo the latest migration
npm run db:seed       # regions plus a placeholder demo user, company, contact and lead
```
