import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApifyWebhook } from '../providers/types.js';

// Ad-hoc Apify webhooks. Each run gets its own webhook whose payload names our step and
// carries an HMAC of it, so the endpoint can tell a real callback from a forged one without
// looking anything up. Apify may deliver a webhook more than once; the runner is idempotent.

export const WEBHOOK_EVENTS = [
  'ACTOR.RUN.SUCCEEDED',
  'ACTOR.RUN.FAILED',
  'ACTOR.RUN.ABORTED',
  'ACTOR.RUN.TIMED_OUT',
  'ACTOR.RUN.RESURRECTED',
];

export function signStep(secret: string, userId: string, stepId: string): string {
  return createHmac('sha256', secret).update(`${userId}:${stepId}`).digest('hex');
}

export function webhookFor(
  config: { url: string; secret: string },
  userId: string,
  stepId: string,
): ApifyWebhook {
  const fields = { userId, stepId, signature: signStep(config.secret, userId, stepId) };
  // Apify fills {{eventType}} and {{resource}}; the rest is a fixed JSON prefix.
  const prefix = JSON.stringify(fields).slice(0, -1);
  return {
    eventTypes: WEBHOOK_EVENTS,
    requestUrl: config.url,
    payloadTemplate: `${prefix},"eventType":{{eventType}},"resource":{{resource}}}`,
  };
}

export interface WebhookPayload {
  userId: string;
  stepId: string;
  signature: string;
  eventType: string | null;
}

/** Parses and authenticates a webhook body. Returns null for anything not signed by us. */
export function verifyWebhook(secret: string, body: unknown): WebhookPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const { userId, stepId, signature, eventType } = body as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof stepId !== 'string' || typeof signature !== 'string')
    return null;
  const expected = Buffer.from(signStep(secret, userId, stepId), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return {
    userId,
    stepId,
    signature,
    eventType: typeof eventType === 'string' ? eventType : null,
  };
}
