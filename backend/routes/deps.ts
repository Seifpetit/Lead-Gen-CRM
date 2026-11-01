import type { Db } from '../data/db.js';
import type { ErrorReporter } from '../runner/errorReporter.js';
import type { DailyJumpConfig, HealthFacts } from '../runner/healthView.js';
import type { DevConsole } from '../runner/devConsole.js';
import type { Orchestrator } from '../runner/orchestrator.js';
import type { Watchdog } from '../runner/watchdog.js';

/** What every route module needs. Handlers call these and the data layer, nothing else. */
export interface RouteDeps {
  db: Db;
  runner: Orchestrator;
  /**
   * Starting a run spends money. Off until the pilot (pass 7) and the owner's go-ahead, so a
   * deployed API can preview and read but not start paid runs.
   */
  paidRunsEnabled: boolean;
  /** Shared secret for the Apify webhook. Without one the webhook is closed (503). */
  webhookSecret: string | null;
  /** Days a removed CRM card stays in Noise; shown as "N days left" and used by the purge. */
  noiseRetentionDays: number;
  /** The most a run's spend cap may be (USD). Checked on preview and on start. */
  maxRunCapUsd: number;
  /** Values that must never be shown in a run's log (API tokens); patterns are hidden anyway. */
  secrets: readonly (string | null | undefined)[];
  /** Where failures are noted; null in tests that do not look at them. */
  errors: ErrorReporter | null;
  /** Looks over runs in progress for stuck and costly ones. */
  watchdog: Watchdog;
  /** What the server was started with, for the Health panel's checks. */
  healthFacts: HealthFacts;
  /** When a day's spend counts as a jump. */
  dailyJump: DailyJumpConfig;
  /** The developer console; null unless DEV_CONSOLE is on. Its routes do not exist without it. */
  devConsole: DevConsole | null;
}
