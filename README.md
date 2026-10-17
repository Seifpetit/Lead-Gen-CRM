# Lead Gen CRM

B2B lead generation for Tunisian freight transporters: pick a region, get named decision-makers
at companies that ship goods, with a contact channel and the source of every value.

## Layout

```
shared/      Types used by both sides (Lead, Company, Contact, Evidence, Run, RunStage, CrmStage)
backend/
  config/    Typed env loader, job-title dictionary (FR/EN), freight sectors, Tunisian governorates
  data/      Data-access layer: the only folder allowed to import the database driver
  providers/ Apify adapters, one interface per stage
  stages/    Pure pipeline stages
  runner/    Persisted, resumable run orchestrator
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
npm run dev:backend         # fails fast if APIFY_TOKEN or DATABASE_URL is missing
npm run dev:frontend        # http://localhost:5173, proxies /api to :3000
```

## Checks

```sh
npm run lint          # ESLint, including the database-driver boundary rule
npm run typecheck     # tsc -b across all packages
npm test              # Vitest across all packages
npm run format:check  # Prettier
```

## Ground rules

- Never fabricate a contact detail. Every stored value carries a source URL, a timestamp, and a
  fact or estimate label.
- No secrets in the repo. The Apify token lives in server-side env only.
- No paid Apify run starts without a spend cap and explicit approval.
- Only `backend/data/` may import the database driver (enforced by lint).
