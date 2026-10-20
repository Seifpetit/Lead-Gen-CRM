import type { EnvError } from './env.js';

/** A configuration problem said in plain words, with what to do, instead of a stack trace. */
export function explainEnvError(err: EnvError): string {
  const lines = err.problems.map((p) => {
    const name = p.split(' ')[0]!;
    if (name === 'APIFY_TOKEN') {
      return '- APIFY_TOKEN is missing: add your Apify API token to the .env file (Apify Console > Settings > Integrations).';
    }
    if (name === 'DATABASE_URL') {
      return '- DATABASE_URL is missing or not a valid address: it looks like postgres://user:password@localhost:5432/dbname (see .env.example).';
    }
    return `- ${p}.`;
  });
  return `The server cannot start because the settings in .env need attention:\n${lines.join('\n')}\nFix them, then start the server again.`;
}
