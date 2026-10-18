import { buildApp, LOG_REDACT } from './app.js';
import { AuthService, DEFAULT_POLICY } from './auth/service.js';
import { loadEnv } from './config/env.js';
import { createDb } from './data/db.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = new AuthService(db, {
  ...DEFAULT_POLICY,
  signupMode: env.SIGNUP_MODE,
  sessionIdleMs: env.SESSION_IDLE_HOURS * 3_600_000,
  sessionMaxMs: env.SESSION_MAX_DAYS * 86_400_000,
});
const app = await buildApp({ db, auth, logger: { level: 'info', redact: LOG_REDACT } });
await app.listen({ port: env.PORT, host: '127.0.0.1' });
