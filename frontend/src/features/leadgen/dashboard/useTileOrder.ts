import type { CrmCard } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';

/**
 * The cards in the order the person arranged them. Until they drag one, it is the server's order;
 * after, the cards they have placed keep their places and anything loaded later follows. A new
 * `resetKey` (another sort or another pipeline) goes back to the server's order, since they asked
 * for that order. The arrangement is not saved: a reload starts from the sort again.
 */
export function useTileOrder(cards: readonly CrmCard[], resetKey: string) {
  const [custom, setCustom] = useState<{ key: string; ids: readonly string[] }>({
    key: resetKey,
    ids: [],
  });
  const placed = custom.key === resetKey ? custom.ids : [];

  const ordered = useMemo(() => {
    if (placed.length === 0) return cards;
    const rank = new Map(placed.map((id, i) => [id, i]));
    const known = cards
      .filter((c) => rank.has(c.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    return [...known, ...cards.filter((c) => !rank.has(c.id))];
  }, [cards, placed]);

  /** Put `id` before `beforeId`, or last when that is null. Returns the new 1-based position. */
  const move = useCallback(
    (id: string, beforeId: string | null): number => {
      const ids = ordered.map((c) => c.id).filter((x) => x !== id);
      const at = beforeId === null ? ids.length : ids.indexOf(beforeId);
      ids.splice(at < 0 ? ids.length : at, 0, id);
      if (ids.join() !== ordered.map((c) => c.id).join()) setCustom({ key: resetKey, ids });
      return ids.indexOf(id) + 1;
    },
    [ordered, resetKey],
  );

  return { ordered, move };
}
