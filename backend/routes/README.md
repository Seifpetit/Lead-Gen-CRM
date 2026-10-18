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

| Method | Path                                   | Purpose                                                                                                                                                                                                  |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/csrf`                       | CSRF token for the current session                                                                                                                                                                       |
| POST   | `/api/runs/preview`                    | Estimated volume, cost, limits and blockers, plus the planned searches (first 50 and the total) and the sector list. Takes optional `sectorIds`, `customWordings`, `cellKeys`. Writes and spends nothing |
| POST   | `/api/runs`                            | Start a run (same optional plan fields as the preview). Needs `confirm: true` and `budgetCapUsd`; 409 if the cap exceeds the month's remaining budget or the concurrent-run limit is hit                 |
| GET    | `/api/runs`                            | Runs with status, region, funnel counts, spent and cap                                                                                                                                                   |
| GET    | `/api/runs/:id`                        | Run detail: step counts, first page of leads with evidence                                                                                                                                               |
| POST   | `/api/runs/:id/stop`                   | Stop a run. Apify runs already out are still collected and settled                                                                                                                                       |
| GET    | `/api/runs/:id/costs`                  | Ledger entries and settlement for one run                                                                                                                                                                |
| GET    | `/api/regions`                         | Regions with coverage, yield, cost per lead, saturation                                                                                                                                                  |
| GET    | `/api/regions/suggestion`              | Next region to run and the scheduler's reason                                                                                                                                                            |
| GET    | `/api/regions/geometry`                | Every region's bounds and drawn outline (OSM polygon, else its bounds as a rectangle). Shared reference data                                                                                             |
| GET    | `/api/coverage`                        | Per region and sector: queries run, new places, leads, spend, cost per lead, state (`not_searched`, `yielding`, `saturated`)                                                                             |
| GET    | `/api/regions/:regionId/cells`         | Cells of a region with their stats                                                                                                                                                                       |
| GET    | `/api/regions/:regionId/cells/:cellId` | One cell with its searches and exhausted wordings                                                                                                                                                        |
| GET    | `/api/leads`                           | Leads, filter by `stage`, `runId`, `regionId`, `minScore`, `q`                                                                                                                                           |
| GET    | `/api/leads/:id`                       | One lead with contact, company and evidence                                                                                                                                                              |
| PATCH  | `/api/leads/:id/stage`                 | Move a lead. Dismissing feeds back into scoring and keeps it from reappearing. Opted out is final                                                                                                        |
| POST   | `/api/leads/:id/objection`             | Record an objection: suppress the person's identifiers and move the lead to Opted out                                                                                                                    |
| GET    | `/api/costs`                           | Ledger totals `?groupBy=run\|region\|provider\|month`                                                                                                                                                    |
| GET    | `/api/costs/budget`                    | Monthly cap, spent and remaining                                                                                                                                                                         |
| PUT    | `/api/costs/budget`                    | Set the monthly cap                                                                                                                                                                                      |
| GET    | `/api/apify/log`                       | Active and recent runs with Apify state history; restarting/resumed runs under `attention`                                                                                                               |
| POST   | `/api/webhooks/apify`                  | Public. Verifies an HMAC signature (`APIFY_WEBHOOK_SECRET`); 503 when no secret is set, 401 on a bad signature; unknown or repeated events get 202 `known: false`                                        |

Every route has a contract test in `api.test.ts`; a test fails if a route is added without one.

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
