import { buildApp, LOG_REDACT } from './app.js';
import { AuthService, DEFAULT_POLICY } from './auth/service.js';
import { EnvError, loadEnv, type Env } from './config/env.js';
import { explainEnvError } from './config/envMessage.js';
import { createDb } from './data/db.js';
import { pendingMigrations } from './data/migrate.js';
import { ErrorReporter } from './runner/errorReporter.js';
import { createSentryReporter } from './lib/sentry.js';
import { Watchdog } from './runner/watchdog.js';
import { createClassifier } from './providers/anthropicClassifier.js';
import { ApifyClient } from './providers/apify.js';
import { EmailFinderVerifier } from './providers/emailFinder.js';
import { GoogleMapsApifyDiscovery, mapsInput } from './providers/googleMapsApify.js';
import {
  CompanyEmployeesFinder,
  LinkedinPeopleFinder,
  ProfileSearchFinder,
} from './providers/linkedin.js';
import { startImageBackfill } from './runner/imageBackfill.js';
import { startNoisePurge } from './runner/noisePurge.js';
import { DevConsole } from './runner/devConsole.js';
import { Orchestrator } from './runner/orchestrator.js';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvError) {
    console.error(explainEnvError(err));
    process.exit(1);
  }
  throw err;
}
const db = createDb(env.DATABASE_URL);
// Say so plainly when the database cannot be reached, instead of failing on the first request.
try {
  await db.query('SELECT 1');
} catch {
  const target = new URL(env.DATABASE_URL);
  console.error(
    `The server cannot reach the database at ${target.hostname}:${target.port || '5432'}.\n` +
      'Check that Postgres is running and that DATABASE_URL in .env is right, then start the server again.',
  );
  process.exit(1);
}
const auth = new AuthService(db, {
  ...DEFAULT_POLICY,
  signupMode: env.SIGNUP_MODE,
  sessionIdleMs: env.SESSION_IDLE_HOURS * 3_600_000,
  sessionMaxMs: env.SESSION_MAX_DAYS * 86_400_000,
  devAdminLogin: env.DEV_ADMIN_LOGIN,
});

// Building the providers makes no request; only a started run calls Apify.
const apify = new ApifyClient(env.APIFY_TOKEN);
// Never shown in a run's log, whatever a provider's error message quotes.
const SECRETS = [
  env.APIFY_TOKEN,
  env.ANTHROPIC_API_KEY,
  env.GOOGLE_PLACES_API_KEY,
  env.APIFY_WEBHOOK_SECRET,
];
// Failures are kept in the database (masked); Sentry only when SENTRY_DSN is set.
const errors = new ErrorReporter(db, SECRETS, createSentryReporter(env.SENTRY_DSN, SECRETS));
// The Claude classifier exists only when a key is set; without one, rules decide alone.
const classifier = createClassifier(env, undefined, {
  onFailure: (err) => void errors.providerFailed('anthropic', err, { step: 'classify' }),
  onSuccess: () => void errors.providerOk('anthropic'),
});
const runner = new Orchestrator({
  secrets: SECRETS,
  errors,
  log: (data, message) => app.log.info(data, message),
  db,
  ...(classifier ? { companyClassifier: classifier, titleClassifier: classifier } : {}),
  discovery: new GoogleMapsApifyDiscovery(apify),
  people: new LinkedinPeopleFinder(
    new CompanyEmployeesFinder(apify),
    new ProfileSearchFinder(apify),
  ),
  emails: new EmailFinderVerifier(apify),
  config: {
    classifierRunCapUsd: env.CLASSIFIER_RUN_CAP_USD,
    maxRunCapUsd: env.MAX_RUN_CAP_USD,
    webhook:
      env.APIFY_WEBHOOK_SECRET && env.PUBLIC_URL
        ? {
            url: new URL('/api/webhooks/apify', env.PUBLIC_URL).toString(),
            secret: env.APIFY_WEBHOOK_SECRET,
          }
        : null,
  },
});

// The developer console exists only with DEV_CONSOLE=true (local development, see config/env.ts).
const devConsole = env.DEV_CONSOLE
  ? new DevConsole({
      db,
      discovery: new GoogleMapsApifyDiscovery(apify),
      buildRequest: mapsInput,
      classifier,
      classifierModel: env.CLASSIFIER_MODEL,
      secrets: SECRETS,
    })
  : null;

const watchdog = new Watchdog({
  db,
  changes: runner.changes,
  config: {
    stuckMinutes: env.STUCK_RUN_MINUTES,
    spendFactor: env.SPEND_ANOMALY_FACTOR,
  },
});

const app = await buildApp({
  db,
  auth,
  runner,
  paidRunsEnabled: env.PAID_RUNS_ENABLED,
  webhookSecret: env.APIFY_WEBHOOK_SECRET ?? null,
  noiseRetentionDays: env.NOISE_RETENTION_DAYS,
  maxRunCapUsd: env.MAX_RUN_CAP_USD,
  secrets: SECRETS,
  errors,
  watchdog,
  devConsole,
  healthFacts: {
    apifyToken: Boolean(env.APIFY_TOKEN),
    anthropicKey: Boolean(env.ANTHROPIC_API_KEY),
    webhook: Boolean(env.APIFY_WEBHOOK_SECRET && env.PUBLIC_URL),
    externalReporting: Boolean(env.SENTRY_DSN),
  },
  dailyJump: { factor: env.DAILY_SPEND_JUMP_FACTOR, floorUsd: 1 },
  logger: { level: 'info', redact: LOG_REDACT },
});

// Anything that escapes is noted (masked) before the process decides what to do about it.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled rejection');
  void errors.error('process', 'unhandled_rejection', reason);
});
process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'uncaught exception');
  void errors.error('process', 'uncaught_exception', err).finally(() => process.exit(1));
});

// A database that is behind the code is the likeliest cause of a run that hangs: say so.
const waiting = await pendingMigrations(db);
if (waiting.length > 0) {
  const text = `${waiting.length} database update(s) are waiting (${waiting.join(', ')}). Run npm run db:migrate, then restart the server. Runs will not start until then.`;
  app.log.warn(text);
  await errors.message('migration', 'migrations_pending', text);
}
if (!env.ANTHROPIC_API_KEY) {
  app.log.info('ANTHROPIC_API_KEY is not set: companies are judged by rules alone.');
}

// Recovery and the polling backup only matter once runs can exist.
if (env.PAID_RUNS_ENABLED) {
  await runner.recover();
  setInterval(() => {
    runner.pollAll().catch((err) => {
      app.log.error({ err }, 'poll failed');
      void errors.error('run', 'poll_failed', err);
    });
  }, 30_000).unref();
  // Stuck and costly runs are looked for every minute.
  setInterval(() => {
    watchdog.check().catch((err) => app.log.error({ err }, 'watchdog failed'));
  }, 60_000).unref();
}
// Removed CRM cards are deleted after NOISE_RETENTION_DAYS, once now and then every day.
startNoisePurge(db, env.NOISE_RETENTION_DAYS, (data, message) => app.log.info(data, message));
// Thumbnails: a free lookup of each company's website image, in the background.
startImageBackfill(db, (data, message) => app.log.info(data, message));
if (env.DEV_CONSOLE) {
  app.log.warn(
    'DEV_CONSOLE is ON: the dev admin can run single pipeline steps by hand (paid, capped per call). Local development only.',
  );
}
if (env.DEV_ADMIN_LOGIN) {
  app.log.warn(
    'DEV_ADMIN_LOGIN is ON: the login test/test is accepted. Local development only; never deploy this.',
  );
}
await app.listen({ port: env.PORT, host: env.HOST });
