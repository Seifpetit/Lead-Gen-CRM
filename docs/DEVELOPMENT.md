# Lead Gen CRM

B2B lead generation for Tunisian freight transporters: pick a region, get named decision-makers
at companies that ship goods, with a contact channel and the source of every value.

## Layout

```
shared/      Types used by both sides (Lead, Company, Contact, Evidence, Run, RunStage, CrmStage)
backend/
  config/    Typed env loader, job-title dictionary (FR/EN), freight sectors, Tunisian governorates
  data/      Data-access layer: the only folder allowed to import the database driver
  lib/       Pure helpers shared by data, providers and stages (normalize, geo, sourced, cost)
  providers/ Apify and Google Places adapters, one interface per stage (no database access)
  stages/    Pure pipeline stages and the query grid (no database access)
  runner/    Run orchestrator: crash-safe runs, caps, claims, coverage scheduler (see its README)
  routes/    Authenticated HTTP endpoints
  auth/      Sessions and password hashing (vetted library)
  httpClient.ts
frontend/    React + Vite app
```

## Run

Requires Node 22.13+ and Docker (for local Postgres).

```sh
npm install
cp .env.example .env        # then set APIFY_TOKEN
npm run db:up               # local Postgres on :5432
npm run db:migrate          # create the schema and seed regions
npm run db:seed             # optional placeholder demo data
npm run auth:create-user -- you@example.com   # prompts for a password (min 12 chars)
npm run dev:backend         # builds shared/ first; fails fast if APIFY_TOKEN or DATABASE_URL is missing
npm run dev:frontend        # builds shared/ first; http://localhost:5173, proxies /api to :3000
npm run e2e -w frontend     # browser smoke test with the fake Apify (see frontend/README.md)
```

## Share a test session

To let one person try the app from their own computer for an hour, without deploying it, open a
temporary Cloudflare quick tunnel from your machine. It gives a throwaway `https://` address that
works only while the command runs, and closing it turns access off.

Before you start the tunnel, because the app will be reachable from the internet:

1. Give the tester their own account with `npm run auth:create-user -- their@email`, and keep
   `SIGNUP_MODE=invite`. Prefer this to the `test` / `test` shortcut: with the tunnel open, anyone
   who got the address could try that login. If you do want to switch the shortcut off, set
   `DEV_ADMIN_LOGIN=false`, restart the backend and run `npm run auth:disable-dev-user`.
2. Keep `PAID_RUNS_ENABLED=false` unless the tester should start paid runs, and keep
   `MAX_RUN_CAP_USD` low.

Then, with the backend and `npm run dev:frontend` running, install
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
and run:

```sh
cloudflared tunnel --url http://localhost:5173
```

Send the printed `https://...trycloudflare.com` address to the tester. When the session ends, press
`Ctrl+C` in that window: the address stops working at once.

## Checks

```sh
npm run lint          # ESLint, including the database-driver boundary rule
npm run typecheck     # tsc -b across all packages
npm test              # Vitest across all packages (needs Postgres, see below)
npm run format:check  # Prettier
```

## Tests and Postgres

Data-layer tests run against a real Postgres at `TEST_DATABASE_URL` (default
`postgres://leadgen:leadgen@localhost:5432/leadgen_test`). Each test file drops and recreates the
schema, so never point it at a database you care about. If Postgres is unreachable, the tests fail
rather than skip.

With Docker, the compose service works: `npm run db:up`, then
`docker compose exec postgres createdb -U leadgen leadgen_test`.

Without Docker (e.g. a cloud dev container), use a locally installed PostgreSQL 16:

```sh
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE ROLE leadgen LOGIN SUPERUSER PASSWORD 'leadgen'" \
  -c "CREATE DATABASE leadgen OWNER leadgen" -c "CREATE DATABASE leadgen_test OWNER leadgen"
```

CI (`.github/workflows/ci.yml`) runs a `postgres:16` service container, then format check,
lint, typecheck and tests on every pull request and push to main.

## Location maps

A company's page shows an OpenStreetMap close-up (drawn with [Leaflet](https://leafletjs.com),
BSD-2) next to a small Tunisia map. The tiles are fetched by the browser straight from
`tile.openstreetmap.org` under OpenStreetMap's [tile usage policy](https://operations.osmfoundation.org/policies/tiles/),
with the required credit on the map: © OpenStreetMap contributors. There is no API key, nothing is
stored but the company's latitude and longitude, and no Google service is called (the "Open in
Google Maps" link is a plain link).

## Data and licences

The 24 governorate outlines come from [geoBoundaries](https://www.geoboundaries.org) (gbOpen,
Tunisia ADM1, boundary TUN-ADM1-13205935), which is derived from OpenStreetMap and so is
licensed under the [Open Database Licence 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
© OpenStreetMap contributors. The app credits it in the corner of the Coverage map.

The processed file is committed (`backend/config/regionOutlines.json`, full precision; the map
is served a lightly simplified copy), so nothing is downloaded at runtime. To rebuild it:

```sh
npm run regions:build        # downloads the source, checks it, rewrites config/region*
npm run db:migrate           # loads the new outlines and bounds into the database
```

## Security

- **Passwords** are hashed with argon2id (the `argon2` library); the app never stores or logs
  them. Minimum length is 12.
- **Sessions** live in Postgres. The cookie (`sid`) is a random 256-bit token, `HttpOnly`,
  `Secure`, `SameSite=Strict`; only its SHA-256 is stored, so a database leak exposes no live
  session. A session ends after 12 hours idle or 7 days in total (`SESSION_IDLE_HOURS`,
  `SESSION_MAX_DAYS`), and logout deletes it server-side.
- **Removed CRM cards** wait in Noise for `NOISE_RETENTION_DAYS` (default 30); a daily job in the
  backend then deletes them and keeps a minimal marker (see `backend/routes/README.md`).
- **A run's spend cap** is at least $0.50 and at most `MAX_RUN_CAP_USD` (default $50); the server
  refuses anything else and the Start a run window shows the same limits.
- **Every route requires a session** unless it is explicitly marked public (only login, sign-up
  and logout are). Unknown routes return 401 too. Handlers pass `currentUser(request).id` to the
  data layer, whose functions only accept that branded `UserId`. Another user's record and a
  nonexistent one both return 404.
- **Brute force:** 5 failed sign-ins for an email within 15 minutes lock it for 15 minutes (the
  correct password is refused while locked); 20 failures from one IP throttle that IP. Unknown
  emails get the same response and timing as wrong passwords.
- **Sign-up** is invite-only by default (`SIGNUP_MODE=invite`): create users with
  `npm run auth:create-user -- <email>` or one-time codes with `npm run auth:create-invite`
  (7-day expiry, stored hashed). `SIGNUP_MODE=open` lets anyone sign up.
- **Local dev shortcut** (`DEV_ADMIN_LOGIN=true`, default off): accepts the login `test` / `test`
  on sign-in, sign-up and `npm run auth:create-user -- test`, skipping only the email-format and
  12-character checks for that exact pair. It is stored like any user (argon2, same sessions,
  rate limit and lockout), and sign-up still needs an invite code in invite mode. The server
  refuses to start with it on if `NODE_ENV=production`, `HOST` is not `127.0.0.1`/`::1`, or
  `PUBLIC_URL` is not a localhost URL, and logs a warning when it is on. To switch it off: set
  `DEV_ADMIN_LOGIN=false` and run `npm run auth:disable-dev-user` (deletes the `test` user and its
  sessions). While the flag is off, the `test` login is refused even if the row still exists.
- **Logs** redact cookies, `Set-Cookie`, authorization headers and any `password`, `token` or
  `inviteCode` field; request bodies are never logged.
- **CSRF:** `SameSite=Strict` cookies plus JSON-only endpoints. Behind a reverse proxy, enable
  Fastify's `trustProxy` for that proxy, or every client shares the proxy's IP for throttling.

## Ground rules

- Never fabricate a contact detail. Every stored value carries a source URL, a timestamp, and a
  fact or estimate label.
- No secrets in the repo. The Apify token lives in server-side env only.
- No paid Apify run starts without a spend cap and explicit approval.
- Only `backend/data/` may import the database driver, and `providers/`, `stages/` and `lib/`
  may not import `data/` at all (both enforced by lint).
- Provider and stage tests use fixtures and fakes only; `fetch` is stubbed to throw.
