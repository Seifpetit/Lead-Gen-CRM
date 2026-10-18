import { buildApp, LOG_REDACT } from './app.js';
import { AuthService, DEFAULT_POLICY } from './auth/service.js';
import { loadEnv } from './config/env.js';
import { createDb } from './data/db.js';
import { ApifyClient } from './providers/apify.js';
import { EmailFinderVerifier } from './providers/emailFinder.js';
import { GoogleMapsApifyDiscovery } from './providers/googleMapsApify.js';
import {
  CompanyEmployeesFinder,
  LinkedinPeopleFinder,
  ProfileSearchFinder,
} from './providers/linkedin.js';
import { Orchestrator } from './runner/orchestrator.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = new AuthService(db, {
  ...DEFAULT_POLICY,
  signupMode: env.SIGNUP_MODE,
  sessionIdleMs: env.SESSION_IDLE_HOURS * 3_600_000,
  sessionMaxMs: env.SESSION_MAX_DAYS * 86_400_000,
});

// Building the providers makes no request; only a started run calls Apify.
const apify = new ApifyClient(env.APIFY_TOKEN);
const runner = new Orchestrator({
  db,
  discovery: new GoogleMapsApifyDiscovery(apify),
  people: new LinkedinPeopleFinder(
    new CompanyEmployeesFinder(apify),
    new ProfileSearchFinder(apify),
  ),
  emails: new EmailFinderVerifier(apify),
  config: {
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
  logger: { level: 'info', redact: LOG_REDACT },
});

// Recovery and the polling backup only matter once runs can exist.
if (env.PAID_RUNS_ENABLED) {
  await runner.recover();
  setInterval(() => {
    runner.pollAll().catch((err) => app.log.error({ err }, 'poll failed'));
  }, 30_000).unref();
}
await app.listen({ port: env.PORT, host: '127.0.0.1' });
