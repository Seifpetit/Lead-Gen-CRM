import { z } from 'zod';

const EnvSchema = z.object({
  APIFY_TOKEN: z.string().min(1),
  /** Google Places API key. Optional: discovery falls back to the Apify Maps Actor. */
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().url(),
  /** Interface the server binds to. Loopback by default. */
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 'invite': sign-up needs a one-time invite code (or an admin creates the user). 'open': anyone. */
  SIGNUP_MODE: z.enum(['invite', 'open']).default('invite'),
  /**
   * Starting a paid run through the API. Off by default: nothing spends Apify money until the
   * pilot pass and the owner's go-ahead.
   */
  PAID_RUNS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Shared secret Apify's webhooks are signed with. Without it the webhook endpoint is closed. */
  APIFY_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Public base URL of this server (https), where Apify can reach /api/webhooks/apify. */
  PUBLIC_URL: z.string().url().optional(),
  /**
   * Local development only: accepts the login `test` / `test` on sign-in and sign-up, skipping
   * just the email-format and minimum-length checks for that exact pair. The server refuses to
   * start with this on in production, on a non-loopback host, or with a non-localhost PUBLIC_URL.
   */
  DEV_ADMIN_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** A session ends after this many hours without a request. */
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  /** A session ends this many days after sign-in, however active. */
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);
const LOCAL_URL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why DEV_ADMIN_LOGIN=true must not run with this configuration, or null if it is safe. */
function devAdminLoginProblem(env: {
  NODE_ENV: string;
  HOST: string;
  PUBLIC_URL?: string | undefined;
}): string | null {
  if (env.NODE_ENV === 'production') return 'NODE_ENV is production';
  if (!LOOPBACK_HOSTS.has(env.HOST)) return 'HOST is not a loopback address (127.0.0.1 or ::1)';
  if (env.PUBLIC_URL && !LOCAL_URL_HOSTS.has(new URL(env.PUBLIC_URL).hostname)) {
    return 'PUBLIC_URL is not a localhost URL';
  }
  return null;
}

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment: ${problems.join('; ')}`);
    this.name = 'EnvError';
  }
}

/**
 * Reads and validates configuration. Throws on the first call if anything required is
 * missing or malformed. Error messages name the variable, never its value.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings as missing so a blank line in .env still fails fast.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => {
        const name = issue.path.join('.');
        return issue.code === 'invalid_type' && cleaned[name] === undefined
          ? `${name} is missing`
          : `${name} is invalid`;
      }),
    );
  }
  if (parsed.data.DEV_ADMIN_LOGIN) {
    const problem = devAdminLoginProblem(parsed.data);
    if (problem) {
      throw new EnvError([`DEV_ADMIN_LOGIN=true is refused because ${problem}. Set it to false`]);
    }
  }
  return parsed.data;
}

/**
 * For the admin CLI, which has no other need of the full environment. Same guards as loadEnv.
 */
export function loadDevAdminLogin(source: NodeJS.ProcessEnv = process.env): boolean {
  const parsed = z
    .object({
      NODE_ENV: EnvSchema.shape.NODE_ENV,
      HOST: EnvSchema.shape.HOST,
      PUBLIC_URL: EnvSchema.shape.PUBLIC_URL,
      DEV_ADMIN_LOGIN: EnvSchema.shape.DEV_ADMIN_LOGIN,
    })
    .safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success)
    throw new EnvError(['DEV_ADMIN_LOGIN, HOST, NODE_ENV or PUBLIC_URL invalid']);
  if (!parsed.data.DEV_ADMIN_LOGIN) return false;
  const problem = devAdminLoginProblem(parsed.data);
  if (problem) {
    throw new EnvError([`DEV_ADMIN_LOGIN=true is refused because ${problem}. Set it to false`]);
  }
  return true;
}
