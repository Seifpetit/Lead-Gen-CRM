import { z } from 'zod';

const EnvSchema = z.object({
  APIFY_TOKEN: z.string().min(1),
  /** Google Places API key. Optional: discovery falls back to the Apify Maps Actor. */
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().url(),
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
  /** A session ends after this many hours without a request. */
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  /** A session ends this many days after sign-in, however active. */
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
});

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
  return parsed.data;
}
