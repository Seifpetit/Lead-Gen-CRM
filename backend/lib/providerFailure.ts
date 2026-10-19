import type { FailureKind, HealthProvider } from '@lead-gen-crm/shared';
import { HttpError } from '../httpClient.js';

// What a failed provider call means, said once. The orchestrator, the health state and the run
// banner all read this, so the same failure is worded the same way everywhere.

const LABEL: Record<HealthProvider, string> = { apify: 'Apify', anthropic: 'Anthropic' };

export interface ProviderFailure {
  provider: HealthProvider;
  kind: FailureKind;
  /** Plain words for people: what happened and what to do. */
  plain: string;
  /** The technical detail, e.g. "HTTP 402 from api.apify.com/v2/acts/x/runs". Mask before storing. */
  detail: string;
  /**
   * The provider answered "no" or never got the request, so nothing was started and nothing
   * was charged: asking again is safe. False when the call may have gone through.
   */
  safeToRetry: boolean;
  /** A key, credit or quota problem: asking again will not help until a person fixes it. */
  needsPerson: boolean;
}

const CREDIT = /credit|insufficient|balance|payment|billing|not enough/i;
const QUOTA = /quota|usage (hard )?limit|monthly (usage|limit)|limit (exceeded|reached)|exceeded/i;

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
/** Failures before any byte reached the provider: nothing can have started. */
const NEVER_REACHED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function codeOf(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : '';
}

function plainFor(provider: HealthProvider, kind: FailureKind): string {
  const who = LABEL[provider];
  switch (kind) {
    case 'invalid_key':
      return `${who} refused the key: check the key in your settings file, then start a new run`;
    case 'out_of_credit':
      return `${who} is out of credit: top up and start a new run`;
    case 'quota_exceeded':
      return `${who} says the usage limit is reached: raise the limit or wait, then start a new run`;
    case 'rate_limited':
      return `${who} is busy and asked us to slow down`;
    case 'timeout':
      return `${who} took too long to answer`;
    case 'server_error':
      return `${who} had a problem on its side`;
    case 'network':
      return `Could not reach ${who}: check the internet connection`;
    default:
      return `${who} returned something unexpected`;
  }
}

/** Sorts any error thrown by a provider call into a kind, with plain words and a retry rule. */
export function classifyProviderFailure(provider: HealthProvider, err: unknown): ProviderFailure {
  let kind: FailureKind = 'unknown';
  let safeToRetry = false;
  let detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);

  if (err instanceof HttpError) {
    detail = err.detail ? `${err.message}: ${err.detail}` : err.message;
    const s = err.status;
    const hint = err.detail ?? '';
    if (s === 401) kind = 'invalid_key';
    else if (s === 402) kind = 'out_of_credit';
    else if (s === 403) {
      kind = CREDIT.test(hint)
        ? 'out_of_credit'
        : QUOTA.test(hint)
          ? 'quota_exceeded'
          : 'invalid_key';
    } else if (s === 429) {
      kind = QUOTA.test(hint) && !/rate/i.test(hint) ? 'quota_exceeded' : 'rate_limited';
      safeToRetry = kind === 'rate_limited';
    } else if (s === 400 && CREDIT.test(hint)) kind = 'out_of_credit';
    else if (s === 408) {
      kind = 'timeout';
    } else if (s >= 500) {
      kind = 'server_error';
      // 502, 503 and 504 come from a gateway in front of the provider: the request was not run.
      safeToRetry = s === 502 || s === 503 || s === 504;
    }
  } else {
    const name = err instanceof Error ? err.name : '';
    const code = codeOf(err);
    if (name === 'TimeoutError' || name === 'AbortError') kind = 'timeout';
    else if (
      NETWORK_CODES.has(code) ||
      (err instanceof TypeError && /fetch failed/i.test(err.message))
    ) {
      kind = 'network';
      safeToRetry = NEVER_REACHED.has(code);
    }
    if (code) detail = `${detail} (${code})`;
  }

  return {
    provider,
    kind,
    plain: plainFor(provider, kind),
    detail,
    safeToRetry,
    needsPerson: kind === 'invalid_key' || kind === 'out_of_credit' || kind === 'quota_exceeded',
  };
}

/** The provider state a failure leaves behind: a key, credit or quota problem is down at once. */
export function healthAfterFailure(
  failure: Pick<ProviderFailure, 'needsPerson'>,
  consecutiveFailures: number,
): 'degraded' | 'down' {
  return failure.needsPerson || consecutiveFailures >= 3 ? 'down' : 'degraded';
}
