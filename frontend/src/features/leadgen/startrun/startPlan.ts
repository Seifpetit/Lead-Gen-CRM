import type { Coverage, RegionSummary } from '@lead-gen-crm/shared';
import { yieldOf } from '../../../lib/coverageView.js';

// What Start a run fills in and decides before the person touches anything. Pure, no React.

export const DEFAULT_CAP_USD = 2;
/** The quick choices next to the cap field. */
export const QUICK_CAPS_USD = [1, 2, 5] as const;
/** A cap above this asks for a second click, so a typo cannot start an expensive run. */
export const CONFIRM_ABOVE_USD = 5;
const CAP_KEY = 'leadgen.run.cap';

/** The cap used for the last run started, else $2. */
export function readCap(): number {
  try {
    const n = Number(window.localStorage.getItem(CAP_KEY));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
  } catch {
    return DEFAULT_CAP_USD;
  }
}

export function saveCap(cap: number): void {
  try {
    window.localStorage.setItem(CAP_KEY, String(cap));
  } catch {
    // Not remembered; the next run starts on $2.
  }
}

/** The text of a cap field that holds a number of dollars. */
export const capText = (cap: number): string => cap.toFixed(2);

/** A number from the cap field, or null when it is empty, not a number or not above zero. */
export function parseCap(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The sector worth searching next in a region: of those searched but not yet saturated, the one
 * that finds the most new places per search. None for a region with no history to go on, so a
 * fresh region starts with nothing ticked rather than everything.
 */
export function suggestedSectors(coverage: Pick<Coverage, 'entries'>, regionId: string): string[] {
  let best: { id: string; yield: number; leads: number } | null = null;
  for (const e of coverage.entries) {
    if (e.regionId !== regionId || e.sectorId === null || e.state !== 'yielding') continue;
    const y = yieldOf(e);
    if (y === null) continue;
    if (!best || y > best.yield || (y === best.yield && e.leads > best.leads)) {
      best = { id: e.sectorId, yield: y, leads: e.leads };
    }
  }
  return best ? [best.id] : [];
}

/** How far a region has got, for its entry in the list: not started, partly or fully covered. */
export type RegionProgress = 'new' | 'partly' | 'saturated';
export function regionProgress(r: Pick<RegionSummary, 'coverage' | 'status'>): RegionProgress {
  if (r.status === 'saturated') return 'saturated';
  return r.coverage === null || r.coverage <= 0 ? 'new' : 'partly';
}

/**
 * A rough range around the expected leads, or null when the estimate is too small to say
 * anything (never a bare 0). It is a band around the estimate, not a statistical interval.
 */
export function leadsRange(leads: number): { low: number; high: number } | null {
  if (!Number.isFinite(leads) || leads < 1) return null;
  return { low: Math.max(1, Math.floor(leads * 0.5)), high: Math.ceil(leads * 1.5) };
}

export interface ConfirmReason {
  aboveCap: boolean;
  bigCap: boolean;
}

/** Whether Start needs a second click: the estimate is above the cap, or the cap is large. */
export function confirmReason(cap: number, estimateUsd: number | null): ConfirmReason | null {
  const aboveCap = estimateUsd !== null && estimateUsd > cap;
  const bigCap = cap > CONFIRM_ABOVE_USD;
  return aboveCap || bigCap ? { aboveCap, bigCap } : null;
}
