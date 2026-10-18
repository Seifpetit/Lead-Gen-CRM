# frontend

React 19 + Vite. Feature folders under `src/`:

| Folder              | What                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`              | The one HTTP client (session cookie, CSRF token, typed errors) and typed calls for every endpoint, from `shared/` types                                               |
| `i18n/`             | **All user-facing strings** in `en.ts`; `t('key', { vars })`. Add `fr.ts` / `ar.ts` as `Dictionary`s and register them in `index.tsx` (Arabic also needs `dir="rtl"`) |
| `features/auth/`    | Sign in (sign-up only when the server allows it), session, route guard                                                                                                |
| `features/leadgen/` | Lead Gen dashboard (Start a run, Runs, Apify log, Costs) and Run detail                                                                                               |
| `features/crm/`     | Pipeline board, stage moves, opt-out with objection                                                                                                                   |
| `components/`       | Shared pieces: Fact/Estimate tags with source and time, dialogs, states                                                                                               |

## Rules the UI follows

- A stored value is shown with its **Fact** or **Estimate** tag, source link and read time. A missing value says "Not found"; a value with no recorded source says "No source recorded". Nothing is filled in.
- Starting a run needs a spend cap and an explicit confirm step; previewing never starts anything.
- Opting a lead out asks for a reason and a confirmation first, and cannot be undone.
- Links only render for http(s) URLs.

## Commands

```
npm run dev:frontend          # http://localhost:5173, proxies /api to :3000
npm test                      # component tests (jsdom), from the repo root
npm run e2e -w frontend       # browser smoke test, see below
```

The dev proxy keeps the browser's `Host` (`changeOrigin: false`): the API checks that a request's `Origin` matches its `Host` as part of CSRF protection. Put production behind a reverse proxy that does the same.

## Browser smoke test

`e2e/smoke.spec.ts` drives Chromium through: sign in, preview and start a run, watch it in the Apify log, open the result, and move a lead through every CRM stage including an opt-out. It starts `backend/test/e2eServer.ts` (the real API and orchestrator with the **fake Apify**, on `TEST_DATABASE_URL`, which it wipes) and the Vite dev server. It cannot reach Apify.

Needs Chromium (`npx playwright install chromium`, or the one already on the machine via `PLAYWRIGHT_BROWSERS_PATH`) and Postgres as for the backend tests. Do not run it while `npm test` is using the same database.
