/** A card is a fixed 88px tall, so a column can place any card without measuring it. */
export const CARD_HEIGHT = 88;
export const CARD_GAP = 8;
/** The room one card takes in a column: its height and the gap under it. */
export const SLOT = CARD_HEIGHT + CARD_GAP;
/** Extra cards drawn above and below what is on screen, so a fast scroll never shows a blank. */
export const OVERSCAN = 4;
/** A column asks for its next page when this much is left below what is on screen. */
export const LOAD_AHEAD = SLOT * 6;
/** The height used for a column before it has been measured (and where nothing can be). */
export const FALLBACK_VIEW_HEIGHT = 640;

export interface Window {
  first: number;
  last: number;
}

/** The cards to draw: those in view plus a few either side, and always `keep` (a card being dragged). */
export function visibleWindow(
  count: number,
  scrollTop: number,
  viewHeight: number,
  slot = SLOT,
): Window {
  if (count === 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / slot) - OVERSCAN);
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewHeight) / slot) + OVERSCAN);
  return { first, last };
}

/** Where a dragged card would land in a column: the slot nearest the pointer. */
export function dropIndex(
  pointerY: number,
  listTop: number,
  scrollTop: number,
  count: number,
  slot = SLOT,
): number {
  const index = Math.round((pointerY - listTop + scrollTop) / slot);
  return Math.min(Math.max(index, 0), count);
}
