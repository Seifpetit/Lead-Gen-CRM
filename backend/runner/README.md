# Run orchestrator

`orchestrator.ts` is the only code that moves a run, a step or a company between states. It
calls the pure stages (`stages/`) and the provider adapters (`providers/`) and persists
everything through `data/`.

A run for one region goes through **discover → qualify → find_people → enrich → verify →
score**. The paid stages (discover, find_people, enrich) are made of steps, one per Apify run:
one per cell and wording, one per qualified company, one per email batch. Each company's
progress is a row in `run_companies`.

## Crash safety

- Every `advance` reads state from the database, does what it can without waiting and commits
  after each step. The process can die anywhere; `recover()` at startup re-reads every
  unfinished run and carries on.
- Before a paid call the step's **estimated cost** goes to `cost_ledger` (with its max cost
  reserved). Right after Apify accepts the run, the **run ID and dataset ID** are stored,
  before any waiting.
- Applying a result is one transaction: the estimates are reversed and actuals appended, the
  output is stored, the step gets `processed_at` and the companies, contacts or leads are
  written. A duplicate (webhook plus poll, or two webhooks) finds `processed_at` set and
  changes nothing.
- **A stage is never started twice.** A pending step that already has an estimate was
  interrupted between the estimate and recording its Apify run; the call may have gone out,
  so the step is closed as failed and its estimate stays as spend. A synchronous step left
  `started` is closed the same way.
- On recovery each step still out with Apify gets a `resumed` event and is polled: finished
  datasets are collected, running ones keep being polled.
- `apify_events` gets `started`, `running` (first RUNNING poll), `restarting` (Apify's
  restart/migration count went up), `resumed`, `finished` and `failed`.
- **Webhooks** (`webhooks.ts`): when `RunnerConfig.webhook` is set, each Apify run gets an
  ad-hoc webhook whose payload carries the user, the step and an HMAC signature;
  `verifyWebhook` rejects anything else, and `onStepWebhook` advances the run. Polling
  (`pollAll`) runs either way as the backup.

## Money

- Three limits, checked before every paid step: the run's `budget_cap_usd`, the user's monthly
  cap (`user_budget`) and at most `maxConcurrentRunsPerUser` (2) running runs, enforced with a
  per-user advisory lock.
- A step is refused, and the run ends `stopped_by_cap`, when its estimate does not fit what is
  left. "Left" subtracts what in-flight steps may still spend beyond their estimates (their max
  cost minus estimate), so runs side by side can't jointly overshoot a cap.
- Each Apify run gets `maxTotalChargeUsd = min(left, max(estimate × 1.25, Actor minimum))`. If
  that falls below the Actor's minimum (Google Maps: $0.50), the step can't start safely and
  the run stops.
- Actuals: the adapters price Apify's charged events; when Apify reports `usageTotalUsd`, the
  unit prices are scaled to match the bill. `settleStepCosts` (data/costLedger.ts) swaps the
  estimate for the actual in one transaction; the ledger stays append-only.
- `reconcileRun` (reconcile.ts) lists estimate vs actual per step and per item, flags
  differences above $0.01 or 20%, steps whose actual disagrees with Apify's reported usage, and
  finished steps never settled.

## Cells, claims and coverage

- A run claims its cells (`cell_claims`) before searching. Claims are per user, atomic per
  cell, renewed on every `advance` and expire after `claimTtlMs` (15 min), so a dead run frees
  its cells. A step whose cell was taken in the meantime is skipped.
- Unique rules on place ID, domain and LinkedIn ID make a racing duplicate insert fail; the
  upserts catch it in a savepoint and merge into the row that won.
- Only companies **new to the user** go through the paid stages; ones already known are
  `skipped`.
- `scheduler.ts`:
  - `planRunCells` ranks cells by leads per dollar (ledger spend) and new places per query
    (`search_queries`): exploit first, keeping one slot to explore never-searched or
    least-searched cells. One run in five (`exploreEvery`) explores only.
  - A wording is exhausted in a cell when a complete search finds fewer new places than
    `yieldFloor`; a cell when all of its wordings are; a region is **saturated** when all of its
    cells are.
  - Saturated regions get **maintenance** runs (`mode: 'maintenance'`): cells not re-searched
    for `maintenanceIntervalDays` are searched again (only new places go on to paid stages)
    and companies whose contacts are older than 90 days are re-checked.
  - `suggestNextRegion` picks the next region and says why, with widening ideas (English
    wordings, adjacent sectors, Arabic wordings) for a saturated region.

## What Apify's documentation says, and what that means here

Checked on 2026-10-17 against docs.apify.com and the four Actors' pages.

| Assumption                                       | What the docs say                                                                                                                                                                                                                                                                                     | Holds?                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Run results stay available until we collect them | Default (unnamed) datasets are kept **7 days on the Free plan, 31 days on paid plans** (3 to 180 configurable on some plans). Named storages are kept indefinitely. The docs don't say whether the clock starts at run end or last access.                                                            | Yes, if the runner is down less than 7 days.           |
| Each Actor accepts a per-run max cost            | `maxTotalChargeUsd` is a run option for any Actor. All four chosen Actors are **pay-per-event**, and for those the platform stops the run when the cap is reached and doesn't bill events past it. Minimum caps: Google Maps $0.50, Company Employees $0.05, Profile Search $0.10, email finder none. | Yes.                                                   |
| Apify reports per-run usage                      | A run object has `usageTotalUsd` ("what you actually pay"), `chargedEventCounts` per event, and `stats` with restart, resurrect and migration counts. `usageUsd` exists only for platform-usage pricing.                                                                                              | Yes, once the run has finished.                        |
| A "restarting" status                            | No such status. Statuses: READY, RUNNING, SUCCEEDED, FAILED, TIMING-OUT, TIMED-OUT, ABORTING, ABORTED. Apify migrates or resurrects runs instead.                                                                                                                                                     | No: mapped to a rise in the restart/migration count.   |
| Webhooks deliver once                            | Delivery is retried with backoff (about 11 tries over about 32 hours) and can be duplicated.                                                                                                                                                                                                          | No: handled by idempotent apply and polling as backup. |

Proposed fixes where an assumption is weak (none applied silently):

1. **Retention.** If the runner can be down longer than 7 days on Free, results are lost but
   already paid for. Fix: run on a paid plan (31 days), or have the adapter write each run to a
   named dataset. Recommendation: alert when a step has been out for more than 3 days.
2. **Status after hitting the max cost.** The docs say the run is stopped but not which final
   status it gets (most likely ABORTED). The adapter reads the dataset of ABORTED and TIMED-OUT
   runs, so the paid-for items are kept either way. To check in the pilot (pass 7).
3. **Usage while running.** Not documented whether `usageTotalUsd` updates during a run. The
   orchestrator only settles costs on a finished run, so a cap during a long run relies on
   Apify's max cost, not on our polling.
4. **Orphan runs.** If the process dies after Apify accepts a run but before its ID is stored,
   that run is orphaned. Its estimate stays in the ledger as spend and the max cost bounds it.
   Fix for later: tag runs with the step ID and look them up in Apify's run list on recovery.

## Known limitations

- A classifier call (LLM) during qualify or title matching runs inside the transaction that
  applies the result; a crash right after it can repeat the call (a few cents at most).
- Maintenance runs rebuild the company's place from stored evidence (name, website, phone,
  LinkedIn); address and category aren't re-checked.
- Governorate bounds aren't seeded yet, so `startRun` fails with "has no map bounds yet" until
  they are set (`setRegionBounds`), or cells are created another way.
- Nothing here runs a real Apify call: tests use `test/fakeProviders.ts`.
