import { TITLE_DICTIONARY } from '../config/titles.js';

/** Title words for the LinkedIn filters: round-robin across role classes, at most 50. */
export function titleKeywords(limit = 50): string[] {
  const lists = Object.values(TITLE_DICTIONARY).map((l) => l.filter((v) => v.length > 3));
  const out: string[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]!);
  }
  return out;
}
