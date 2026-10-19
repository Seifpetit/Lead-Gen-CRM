import { describe, expect, it } from 'vitest';
import { CARD_GAP, CARD_HEIGHT, OVERSCAN, SLOT, dropIndex, visibleWindow } from './boardLayout.js';

describe('a column window', () => {
  it('draws the cards in view plus a few either side', () => {
    expect(SLOT).toBe(CARD_HEIGHT + CARD_GAP);
    expect(visibleWindow(1000, 0, 600)).toEqual({
      first: 0,
      last: Math.ceil(600 / SLOT) + OVERSCAN,
    });
    const w = visibleWindow(1000, SLOT * 100, 600);
    expect(w.first).toBe(100 - OVERSCAN);
    expect(w.last - w.first).toBeLessThan(25);
  });

  it('never goes past the cards there are', () => {
    expect(visibleWindow(3, 0, 600)).toEqual({ first: 0, last: 2 });
    expect(visibleWindow(0, 0, 600).last).toBeLessThan(0);
    expect(visibleWindow(50, SLOT * 49, 600).last).toBe(49);
  });
});

describe('where a dragged card lands', () => {
  it('is the slot nearest the pointer, counting the scroll', () => {
    expect(dropIndex(100, 100, 0, 10)).toBe(0);
    expect(dropIndex(100 + SLOT * 0.4, 100, 0, 10)).toBe(0);
    expect(dropIndex(100 + SLOT * 0.6, 100, 0, 10)).toBe(1);
    expect(dropIndex(100 + SLOT * 3, 100, 0, 10)).toBe(3);
    expect(dropIndex(100, 100, SLOT * 20, 40)).toBe(20);
  });

  it('stays inside the column: above the first card is first, below the last is the end', () => {
    expect(dropIndex(0, 100, 0, 10)).toBe(0);
    expect(dropIndex(5000, 100, 0, 10)).toBe(10);
    expect(dropIndex(5000, 100, 0, 0)).toBe(0);
  });
});
