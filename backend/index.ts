import { buildApp, LOG_REDACT } from './app.js';
import { AuthService, DEFAULT_POLICY } from './auth/service.js';
import { loadEnv } from './config/env.js';
import { createDb } from './data/db.js';
import { createClassifier } from './providers/anthropicClassifier.js';
import { ApifyClient } from './providers/apify.js';
import { EmailFinderVerifier } from './providers/emailFinder.js';
import { GoogleMapsApifyDiscovery } from './providers/googleMapsApify.js';
import {
  CompanyEmployeesFinder,
  LinkedinPeopleFinder,
  ProfileSearchFinder,
} from './providers/linkedin.js';
import { startImageBackfill } from './runner/imageBackfill.js';
import { startNoisePurge } from './runner/noisePurge.js';
import { Orchestrator } from './runner/orchestrator.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = new AuthService(db, {
  ...DEFAULT_POLICY,
  signupMode: env.SIGNUP_MODE,
  sessionIdleMs: env.SESSION_IDLE_HOURS * 3_600_000,
  sessionMaxMs: env.SESSION_MAX_DAYS * 86_400_000,
  devAdminLogin: env.DEV_ADMIN_LOGIN,
});

// Building the providers makes no request; only a started run calls Apify.
const apify = new ApifyClient(env.APIFY_TOKEN);
// The Claude classifier exists only when a key is set; without one, rules decide alone.
const classifier = createClassifier(env);
const runner = new Orchestrator({
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
    webhook:
      env.APIFY_WEBHOOK_SECRET && env.PUBLIC_URL
        ? {
            url: new URL('/api/webhooks/apify', env.PUBLIC_URL).toString(),
            secret: env.APIFY_WEBHOOK_SECRET,
          }
        : null,
  },
});

const app = await buildApp({
  db,
  auth,
  runner,
  paidRunsEnabled: env.PAID_RUNS_ENABLED,
  webhookSecret: env.APIFY_WEBHOOK_SECRET ?? null,
  noiseRetentionDays: env.NOISE_RETENTION_DAYS,
  logger: { level: 'info', redact: LOG_REDACT },
});

// Recovery and the polling backup only matter once runs can exist.
if (env.PAID_RUNS_ENABLED) {
  await runner.recover();
  setInterval(() => {
    runner.pollAll().catch((err) => app.log.error({ err }, 'poll failed'));
  }, 30_000).unref();
}
// Removed CRM cards are deleted after NOISE_RETENTION_DAYS, once now and then every day.
startNoisePurge(db, env.NOISE_RETENTION_DAYS, (data, message) => app.log.info(data, message));
// Thumbnails: a free lookup of each company's website image, in the background.
startImageBackfill(db, (data, message) => app.log.info(data, message));
if (env.DEV_ADMIN_LOGIN) {
  app.log.warn(
    'DEV_ADMIN_LOGIN is ON: the login test/test is accepted. Local development only; never deploy this.',
  );
}
await app.listen({ port: env.PORT, host: env.HOST });
