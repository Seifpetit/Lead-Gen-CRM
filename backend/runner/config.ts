// Orchestrator settings. Defaults are starting points to tune after the pilot (pass 7).

export interface RunnerConfig {
  /** Runs a user may have pending or running at once. */
  maxConcurrentRunsPerUser: number;
  /** Cells a run claims and searches. */
  cellsPerRun: number;
  /** A claim lapses this long after the run's last heartbeat, freeing its cells. */
  claimTtlMs: number;
  /** Places requested per query (Google Places returns at most 60). */
  maxPlacesPerQuery: number;
  /** A wording is exhausted in a cell when its last run found fewer new places than this. */
  yieldFloor: number;
  /** Every Nth run explores the least-covered region instead of exploiting the best one. */
  exploreEvery: number;
  /** Contacts older than this are re-checked by maintenance runs. */
  staleContactDays: number;
  /** A saturated region's cells are re-searched no more often than this. */
  maintenanceIntervalDays: number;
  /** People requested per company. */
  maxPeoplePerCompany: number;
  /** People kept per company as leads. */
  maxLeadsPerCompany: number;
  /** Email lookups per Apify run. */
  emailBatchSize: number;
  /** Apify max cost per run: the step's estimate times this, within the remaining budget. */
  maxChargeHeadroom: number;
  /** Paid steps a run keeps in flight at once. */
  maxInFlightSteps: number;
  /** Days before Google-sourced company fields must be refreshed (Google storage terms). */
  googleRefreshDays: number;
  /** Ad-hoc Apify webhooks, when the server is reachable from Apify. Polling runs either way. */
  webhook: { url: string; secret: string } | null;
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  maxConcurrentRunsPerUser: 2,
  cellsPerRun: 4,
  claimTtlMs: 15 * 60_000,
  maxPlacesPerQuery: 20,
  yieldFloor: 1,
  exploreEvery: 5,
  staleContactDays: 90,
  maintenanceIntervalDays: 30,
  maxPeoplePerCompany: 10,
  maxLeadsPerCompany: 2,
  emailBatchSize: 100,
  maxChargeHeadroom: 1.25,
  maxInFlightSteps: 4,
  googleRefreshDays: 30,
  webhook: null,
};
