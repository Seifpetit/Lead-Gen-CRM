import type { EvidenceKind } from '@lead-gen-crm/shared';

/** A value together with where and when it was read. Write functions only accept these. */
export interface Sourced<T> {
  value: T;
  sourceUrl: string;
  /** When the source was read. */
  fetchedAt: Date;
  kind: EvidenceKind;
}

export class EvidenceError extends Error {
  constructor(field: string, problem: string) {
    super(`Evidence for ${field} ${problem}`);
    this.name = 'EvidenceError';
  }
}

export function assertSourced(field: string, s: Sourced<unknown>): void {
  if (!/^https?:\/\/\S+$/.test(s.sourceUrl))
    throw new EvidenceError(field, 'needs an http(s) source URL');
  if (Number.isNaN(s.fetchedAt.getTime()))
    throw new EvidenceError(field, 'needs a valid fetchedAt');
  if (s.fetchedAt.getTime() > Date.now() + 60_000)
    throw new EvidenceError(field, 'has a fetchedAt in the future');
  if (s.kind !== 'fact' && s.kind !== 'estimate')
    throw new EvidenceError(field, 'needs kind fact or estimate');
}
