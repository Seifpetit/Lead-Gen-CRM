import { z } from 'zod';

const EnvSchema = z.object({
  APIFY_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
