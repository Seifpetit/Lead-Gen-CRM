import type { HealthProvider } from '@lead-gen-crm/shared';
import {
  fingerprintOf,
  markProviderFailed,
  markProviderOk,
  recordError,
} from '../data/appErrors.js';
import type { Queryable } from '../data/db.js';
import type { UserId } from '../data/ids.js';
import {
  classifyProviderFailure,
  healthAfterFailure,
  type ProviderFailure,
} from './providerFailure.js';
import { redactSecrets } from './redact.js';
import type { Reporter } from './sentry.js';

export interface ErrorContext {
  userId?: UserId | null;
  runId?: string | null;
  step?: string | null;
}

/**
 * The one place failures are noted: stored (masked) in app_errors, counted against the
 * provider's health, and, only when a DSN is set, sent to Sentry. Every method swallows its own
 * failures: noting an error must never cause one.
 */
export class ErrorReporter {
  constructor(
    private readonly db: Queryable,
    private readonly secrets: readonly (string | null | undefined)[] = [],
    private readonly external: Reporter | null = null,
    /** Called after a provider's state changes, so open pages can refresh. */
    private readonly onChange?: () => void,
  ) {}

  /** Notes a failed provider call and returns how it was classified. */
  async providerFailed(
    provider: HealthProvider,
    err: unknown,
    ctx: ErrorContext = {},
  ): Promise<ProviderFailure> {
    const failure = classifyProviderFailure(provider, err);
    const message = `${failure.plain}. Technical detail: ${redactSecrets(failure.detail, this.secrets)}`;
    await recordError(this.db, {
      ...ctx,
      source: 'provider',
      provider,
      kind: failure.kind,
      message,
      stack: err instanceof Error ? err.stack : null,
      secrets: this.secrets,
    });
    try {
      await markProviderFailed(
        this.db,
        provider,
        { kind: failure.kind, reason: failure.plain },
        (n) => healthAfterFailure(failure, n),
      );
      this.onChange?.();
    } catch {
      // Health is advice; the run's own handling does not depend on it.
    }
    this.send({ source: 'provider', provider, step: ctx.step, kind: failure.kind, message });
    return failure;
  }

  /** Notes that a provider call went through. */
  async providerOk(provider: HealthProvider): Promise<void> {
    try {
      await markProviderOk(this.db, provider);
    } catch {
      // See providerFailed.
    }
  }

  /** Notes any other failure: an unhandled request error, a failed run, a bad webhook. */
  async error(
    source: string,
    kind: string,
    err: unknown,
    ctx: ErrorContext & { provider?: string | null } = {},
  ): Promise<void> {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await recordError(this.db, {
      ...ctx,
      source,
      kind,
      message: text,
      stack: err instanceof Error ? err.stack : null,
      secrets: this.secrets,
    });
    this.send({ source, provider: ctx.provider, step: ctx.step, kind, message: text });
  }

  /** A failure that has its message already (a run that ended with a plain error). */
  async message(
    source: string,
    kind: string,
    message: string,
    ctx: ErrorContext & { provider?: string | null } = {},
  ): Promise<void> {
    await recordError(this.db, { ...ctx, source, kind, message, secrets: this.secrets });
    this.send({ source, provider: ctx.provider, step: ctx.step, kind, message });
  }

  private send(e: {
    source: string;
    kind: string;
    message: string;
    provider?: string | null | undefined;
    step?: string | null | undefined;
  }): void {
    this.external?.report({ ...e, fingerprint: fingerprintOf(e) });
  }
}
