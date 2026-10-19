import type { ApifyStepView } from '@lead-gen-crm/shared';
import { groupOf, type StepGroup } from '../stepText.js';

/** What each kind of step cost, in the order the run goes (searches, people, emails, the rest). */
export function stageCosts(steps: readonly ApifyStepView[]): { group: StepGroup; usd: number }[] {
  const totals = new Map<StepGroup, number>();
  for (const s of steps) {
    const g = groupOf(s.stage);
    totals.set(g, (totals.get(g) ?? 0) + s.costUsd);
  }
  const order: StepGroup[] = ['discover', 'find_people', 'enrich', 'other'];
  return order.filter((g) => totals.has(g)).map((g) => ({ group: g, usd: totals.get(g) ?? 0 }));
}
