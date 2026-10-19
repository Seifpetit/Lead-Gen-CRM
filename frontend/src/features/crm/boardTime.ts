import type { CrmCard } from '@lead-gen-crm/shared';

const DAY_MS = 86_400_000;

/** Whole days since the card entered its stage; never negative. */
export function daysInStage(card: CrmCard, now: Date = new Date()): number {
  const since = Date.parse(card.stageEnteredAt);
  if (Number.isNaN(since)) return 0;
  return Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
}

/** Days until a Noise card is deleted, rounded up so a fresh removal reads as the full period. */
export function daysLeft(card: CrmCard, now: Date = new Date()): number | null {
  if (!card.purgeAt) return null;
  const at = Date.parse(card.purgeAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / DAY_MS));
}
