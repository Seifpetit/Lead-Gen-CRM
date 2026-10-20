import { randomBytes } from 'node:crypto';
import { redactSecrets } from './redact.js';

// Optional reporting to Sentry, only when SENTRY_DSN is set. Off by default: without a DSN
// nothing here runs and nothing leaves the machine. It speaks Sentry's plain HTTP envelope
// format, so there is no extra library to trust. Only the masked message and the kind of
// failure are sent: no user, no run, no company data.

export interface SentryEvent {
  message: string;
  source: string;
  kind: string;
  provider?: string | null | undefined;
  step?: string | null | undefined;
  fingerprint: string;
}

export interface Reporter {
  report(event: SentryEvent): void;
}

export type Post = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<unknown>;

interface Parsed {
  url: string;
  key: string;
}

/** The envelope URL and public key of a DSN such as https://KEY@o123.ingest.sentry.io/456, or null if it is not one. */
export function parseDsn(dsn: string): Parsed | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, '');
    if (
      (u.protocol !== 'https:' && u.protocol !== 'http:') ||
      !u.username ||
      !/^\d+$/.test(project)
    ) {
      return null;
    }
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

/** A reporter for the DSN, or null when none is set or it is not valid. */
export function createSentryReporter(
  dsn: string | undefined,
  secrets: readonly (string | null | undefined)[] = [],
  post: Post = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
): Reporter | null {
  if (!dsn) return null;
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  const sent = new Set<string>();
  return {
    report(event) {
      // Once per kind of failure per process: repeats are counted on the Health page instead.
      if (sent.has(event.fingerprint)) return;
      sent.add(event.fingerprint);
      const id = randomBytes(16).toString('hex');
      const body = [
        JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify({
          event_id: id,
          timestamp: Date.now() / 1000,
          level: 'error',
          platform: 'node',
          message: redactSecrets(event.message, secrets),
          fingerprint: [event.fingerprint],
          tags: {
            source: event.source,
            kind: event.kind,
            ...(event.provider ? { provider: event.provider } : {}),
            ...(event.step ? { step: event.step } : {}),
          },
        }),
      ].join('\n');
      void Promise.resolve(
        post(parsed.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_client=lead-gen-crm/1, sentry_key=${parsed.key}`,
          },
          body,
        }),
      ).catch(() => undefined);
    },
  };
}
