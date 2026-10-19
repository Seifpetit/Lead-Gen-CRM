# backend/routes

HTTP API. Handlers are thin: validate with a zod schema, call the runner or the data layer,
return a type from `shared/src/api.ts`. Every route requires a session and is scoped to the
signed-in user (another user's data is a 404, never a 403), except the Apify webhook.

## Conventions

- **Auth:** session cookie (pass 2). No cookie: 401.
- **CSRF:** every POST/PUT/PATCH/DELETE needs `x-csrf-token` (get it from `GET /api/auth/csrf`; it
  is derived from the session cookie) and an `Origin` that matches the `Host`. Failure: 403
  `csrf_failed`. The webhook is exempt (`config.csrf = false`) because Apify is not a browser.
- **Errors:** `{ error: <code>, message?, issues?: [{ path, message }] }`. Validation: 400
  `invalid_request`. Unknown or malformed IDs: 404.
- **Pagination:** list endpoints take `?limit` (1 to 100, default 50) and `?offset` and return
  `{ items, total, limit, offset, nextOffset }`.
- **Money:** USD. Anything computed from assumptions is labelled `kind: 'estimate'`.
- **Paid runs:** `POST /api/runs` returns 403 `paid_runs_disabled` unless `PAID_RUNS_ENABLED=true`.
  It stays off until the pilot pass and the owner's go-ahead. Preview and reads always work.

## Routes

| Method | Path                                   | Purpose                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/csrf`                       | CSRF token for the current session                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/api/runs/preview`                    | Estimated volume, cost, limits and blockers, plus the planned searches (first 50 and the total) and the sector list. Takes optional `sectorIds`, `customWordings`, `cellKeys`. Writes and spends nothing                                                                                                                                                                              |
| POST   | `/api/runs`                            | Start a run (same optional plan fields as the preview). Needs `confirm: true` and `budgetCapUsd`; 409 if the cap exceeds the month's remaining budget or the concurrent-run limit is hit                                                                                                                                                                                              |
| GET    | `/api/runs`                            | Runs with status, region, funnel counts, spent and cap                                                                                                                                                                                                                                                                                                                                |
| GET    | `/api/runs/:id`                        | Run detail: step counts, first page of leads with evidence                                                                                                                                                                                                                                                                                                                            |
| POST   | `/api/runs/:id/stop`                   | Stop a run. Apify runs already out are still collected and settled                                                                                                                                                                                                                                                                                                                    |
| GET    | `/api/runs/:id/costs`                  | Ledger entries and settlement for one run                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/api/regions`                         | Regions with coverage, yield, cost per lead, saturation                                                                                                                                                                                                                                                                                                                               |
| GET    | `/api/regions/suggestion`              | Next region to run and the scheduler's reason                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/api/regions/geometry`                | Every region's bounds and drawn outline (OSM polygon, else its bounds as a rectangle). Shared reference data                                                                                                                                                                                                                                                                          |
| GET    | `/api/coverage`                        | Per region and sector: queries run, new places, leads, spend, cost per lead, state (`not_searched`, `yielding`, `saturated`)                                                                                                                                                                                                                                                          |
| GET    | `/api/regions/:regionId/cells`         | Cells of a region with their stats                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/api/regions/:regionId/cells/:cellId` | One cell with its searches and exhausted wordings                                                                                                                                                                                                                                                                                                                                     |
| GET    | `/api/leads`                           | Leads, filter by `stage`, `runId`, `regionId`, `minScore`, `q`                                                                                                                                                                                                                                                                                                                        |
| GET    | `/api/leads/:id`                       | One lead with contact, company and evidence                                                                                                                                                                                                                                                                                                                                           |
| PATCH  | `/api/leads/:id/stage`                 | Move a lead. Dismissing feeds back into scoring and keeps it from reappearing. Opted out is final                                                                                                                                                                                                                                                                                     |
| POST   | `/api/leads/:id/objection`             | Record an objection: suppress the person's identifiers and move the lead to Opted out                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/crm/:pipeline`                   | A board (`companies` or `people`): its columns, each with its true `total` for the filters, its first page of cards (`limit` 1 to 100, default 50) and a `nextCursor`, plus the `sectors` on the board. Filters and sort, all applied here: `q` (company name, website, person name, job title), `sector`, `minScore`, `sort` (`newest`, `score`, `days`, `name`, `sector`) and `dir` |
| GET    | `/api/crm/:pipeline/cards`             | One page of cards in the same filters and sort. `stage` for one column (omitted: every column, the table view), `cursor` from the last page, `limit`. A cursor is exact even when many cards share a score or a date; 400 `invalid_cursor` / `invalid_stage`                                                                                                                          |
| POST   | `/api/crm/cards/:id/move`              | Move a card to a column (`stage`, plus `reason` for Opted out). 409 `decision_maker_required` for a company with no live decision-maker, 409 `opted_out_is_final`. Into Noise is a removal, out of it a restore                                                                                                                                                                       |
| POST   | `/api/crm/cards/:id/decision-maker`    | Name the decision-maker of a company card: `fullName` and at least one of `email`, `phone`, `linkedinUrl`. 201 with the company card (moved) and the new person card (New); 409 `suppressed`                                                                                                                                                                                          |
| POST   | `/api/crm/cards/:id/remove`            | Move a card to Noise and feed the dismissal into scoring. 409 for an Opted out card                                                                                                                                                                                                                                                                                                   |
| POST   | `/api/crm/cards/:id/restore`           | Bring a Noise card back to the column it came from (or `stage`)                                                                                                                                                                                                                                                                                                                       |
| GET    | `/api/costs`                           | Ledger totals `?groupBy=run\|region\|provider\|month`                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/costs/budget`                    | Monthly cap, spent and remaining                                                                                                                                                                                                                                                                                                                                                      |
| PUT    | `/api/costs/budget`                    | Set the monthly cap                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/api/apify/log`                       | Active and recent runs with Apify state history; restarting/resumed runs under `attention`                                                                                                                                                                                                                                                                                            |
| POST   | `/api/webhooks/apify`                  | Public. Verifies an HMAC signature (`APIFY_WEBHOOK_SECRET`); 503 when no secret is set, 401 on a bad signature; unknown or repeated events get 202 `known: false`                                                                                                                                                                                                                     |

Every route has a contract test in `api.test.ts`; a test fails if a route is added without one.

## CRM boards

Two boards, one card per company (Companies) and one per decision-maker (People). A card's column
lives in `crm_cards`; `crm_leads` keeps the scored lead and mirrors only what the rest of the
system reads from it: `dismissed` (scoring feedback) and `opted_out` (suppression).

- **Joining:** every company that gets a lead gets a card in Found. Existing leads were moved there
  by migration 009, one card per company; the People board starts empty. Contacts the runs found
  are not given cards: a person card exists only after the user names the decision-maker.
- **The last company column:** Decision-maker identified is reached by `decision-maker`, which in
  one transaction stores the person (refused when on the suppression list), creates their card in
  New and moves the company. A company that already has a live person card may be moved back into
  the column without the form.
- **Remove / restore:** Remove moves the card to Noise with `noise_at` and the column it came from,
  and sets the matching leads to `dismissed`, which the next scoring runs read. Restore reverses
  both. Opted out cards cannot be removed.
- **Opted out** (people only) needs a reason, puts the person's email, phone and LinkedIn ID on the
  global suppression list and is final. The table forbids `noise_at` on such a card, so the purge
  can never select it, and a company with an Opted out person is never deleted.
- **Purge:** the backend runs it at start and then every 24 hours (`runner/noisePurge.ts`). Cards in
  Noise longer than `NOISE_RETENTION_DAYS` are deleted. A purged company leaves a marker (place ID,
  normalized name, governorate, phone, sector); a purged person leaves LinkedIn ID, email, phone,
  role class and sector. Runs skip a place that matches a company marker (place ID, or name plus
  phone, or name plus governorate when it had neither) and do not store a person who matches a
  person marker. Markers also keep counting toward the dismissal feedback. A company is deleted
  only when no other card hangs on it.
- **Cards carry** `stageEnteredAt` (days in stage) and, in Noise, `noiseAt` and `purgeAt` (days left).

## Search plan

`POST /api/runs/preview` and `POST /api/runs` take the same optional fields:

- `sectorIds`: sectors to search. Omitted = all. `[]` = only `customWordings` (400 if there are none).
- `customWordings`: up to 20, each 1 to 80 characters. Whitespace is collapsed, control characters
  are removed and duplicates (accents and case ignored) are dropped. They are searched as typed,
  after the sector wordings, with `sectorId: null`.
- `cellKeys`: restrict the run to these cells of the region. Cells that are exhausted, claimed or
  unknown are not used; if none is left the preview reports `no_free_cells`.

The preview returns `queries` (the first 50 as `{ wording, sectorId, cellKey }`), `queriesTotal`
and `sectors` (`{ id, name, wordings }`). The estimate is computed from exactly those queries.

## Coverage

`GET /api/coverage` is built from the user's own `search_queries`, leads and cost ledger.
Spend is attributed to a sector as follows: a discovery step to the sector it searched, a people
search to its company's sector, an email batch split evenly over its companies. Spend that cannot
be tied to one sector (typed-in wordings, model calls during qualify) is reported under
`sectorId: null`, so a region's entries add up to its ledger total. Leads count under the sector of
their company. A sector is `saturated` in a region when, in every cell, the cell is exhausted or all
the sector's wordings are.
