import type {
  HealthCheck,
  HealthProvider,
  HealthView,
  HealthWarning,
  ProviderHealth,
} from '@lead-gen-crm/shared';
import { HEALTH_PROVIDERS } from '@lead-gen-crm/shared';
import { listErrors, listProviderHealth } from '../data/appErrors.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import { pendingMigrations, type Migration } from '../data/migrate.js';
import { dailyActualSpend } from '../data/runHealth.js';
import { dailySpendJump } from './anomaly.js';

/** What the server was started with, as yes or no: never the values themselves. */
export interface HealthFacts {
  apifyToken: boolean;
  anthropicKey: boolean;
  webhook: boolean;
  externalReporting: boolean;
}

export const DEFAULT_HEALTH_FACTS: HealthFacts = {
  apifyToken: true,
  anthropicKey: false,
  webhook: false,
  externalReporting: false,
};

export interface DailyJumpConfig {
  /** 0 turns the warning off. */
  factor: number;
  floorUsd: number;
}

export const DEFAULT_DAILY_JUMP: DailyJumpConfig = { factor: 3, floorUsd: 1 };

const money = (n: number) => `$${n.toFixed(2)}`;

const PROVIDER_LABEL: Record<HealthProvider, string> = { apify: 'Apify', anthropic: 'Anthropic' };

/** One entry for every provider, ok when nothing has gone wrong yet. */
function withAllProviders(rows: ProviderHealth[]): ProviderHealth[] {
  return HEALTH_PROVIDERS.map(
    (provider) =>
      rows.find((r) => r.provider === provider) ?? {
        provider,
        state: 'ok' as const,
        reason: null,
        kind: null,
        since: null,
        lastOkAt: null,
      },
  );
}

/** The startup checks: keys, database, migrations, reporting. Plain words, never a secret. */
export function buildChecks(
  facts: HealthFacts,
  pending: readonly string[],
  databaseUp: boolean,
): HealthCheck[] {
  return [
    facts.apifyToken
      ? { id: 'apify_token', status: 'ok', message: 'The Apify key is set.' }
      : {
          id: 'apify_token',
          status: 'fail',
          message:
            'The Apify key (APIFY_TOKEN) is missing: add it to the .env file and restart the server.',
        },
    facts.anthropicKey
      ? { id: 'anthropic_key', status: 'ok', message: 'The Anthropic key is set.' }
      : {
          id: 'anthropic_key',
          status: 'warn',
          message:
            'The Anthropic key (ANTHROPIC_API_KEY) is not set: companies are judged by rules alone, and unclear ones wait for your review.',
        },
    databaseUp
      ? { id: 'database', status: 'ok', message: 'The database answers.' }
      : {
          id: 'database',
          status: 'fail',
          message: 'The database cannot be reached: check that Postgres is running.',
        },
    pending.length === 0
      ? { id: 'migrations', status: 'ok', message: 'The database is up to date.' }
      : {
          id: 'migrations',
          status: 'fail',
          message: `${pending.length === 1 ? '1 database update is' : `${pending.length} database updates are`} waiting: run npm run db:migrate, then restart the server.`,
        },
    facts.webhook
      ? { id: 'webhook', status: 'ok', message: 'Apify tells this server when a step is done.' }
      : {
          id: 'webhook',
          status: 'ok',
          message: 'No webhook is set, so finished steps are found by checking every 30 seconds.',
        },
    facts.externalReporting
      ? {
          id: 'external_reporting',
          status: 'ok',
          message: 'Error reports go to Sentry (masked messages only).',
        }
      : {
          id: 'external_reporting',
          status: 'ok',
          message: 'Error reporting to Sentry is off: nothing leaves this machine.',
        },
  ];
}

/** Everything the Health panel and the in-app notices show. */
export async function buildHealth(
  db: Queryable,
  userId: UserId,
  opts: {
    facts?: HealthFacts;
    migrations?: readonly Migration[];
    dailyJump?: DailyJumpConfig;
    now?: Date;
  } = {},
): Promise<HealthView> {
  const now = opts.now ?? new Date();
  const facts = opts.facts ?? DEFAULT_HEALTH_FACTS;
  let databaseUp = true;
  let providers: ProviderHealth[] = [];
  let errors: HealthView['errors'] = [];
  const warnings: HealthWarning[] = [];
  try {
    providers = await listProviderHealth(db);
    errors = await listErrors(db, userId, 20);
    const jump = opts.dailyJump ?? DEFAULT_DAILY_JUMP;
    const spend = await dailyActualSpend(db, userId, now);
    const j = dailySpendJump({
      todayUsd: spend.today,
      earlierDaysUsd: spend.earlier,
      factor: jump.factor,
      floorUsd: jump.floorUsd,
    });
    if (j.jump) {
      warnings.push({
        kind: 'daily_spend_jump',
        message:
          j.usualUsd > 0
            ? `Today's spend, ${money(spend.today)}, is more than ${jump.factor} times the usual day (${money(j.usualUsd)}).`
            : `Today's spend, ${money(spend.today)}, is high for a first day of use.`,
      });
    }
  } catch {
    databaseUp = false;
  }
  const pending = databaseUp
    ? await pendingMigrations(db, opts.migrations as Migration[] | undefined)
    : [];
  const checks = buildChecks(facts, pending, databaseUp);
  const all = withAllProviders(providers);

  const notices = [
    ...all
      .filter((p) => p.state === 'down' && p.reason)
      .map((p) => ({ id: `provider:${p.provider}`, message: p.reason! })),
    ...checks
      .filter((c) => c.status === 'fail')
      .map((c) => ({ id: `check:${c.id}`, message: c.message })),
  ];
  return {
    providers: all,
    errors,
    pendingMigrations: pending,
    checks,
    warnings,
    notices,
    checkedAt: now.toISOString(),
  };
}

export { PROVIDER_LABEL };
