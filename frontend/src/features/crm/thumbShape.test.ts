import { describe, expect, it } from 'vitest';
import { THUMB_SHAPES, hashText, thumbShape } from './thumbShape.js';

describe('thumbShape', () => {
  it('gives the same shape for the same id, every time', () => {
    const id = '7f1c2d9e-3b4a-4c55-8e21-0a9d6b7c1234';
    const first = thumbShape(id);
    for (let i = 0; i < 20; i++) expect(thumbShape(id)).toBe(first);
  });

  it('is pinned to known values, so a change to the hash shows up', () => {
    expect(hashText('')).toBe(0x811c9dc5);
    expect(hashText('a')).toBe(0xe40c292c);
    expect(thumbShape('co-1')).toBe(THUMB_SHAPES[hashText('co-1') % 6]);
  });

  it('only returns shapes from the set, and uses every one of them across many ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const shape = thumbShape(`company-${i}`);
      expect(THUMB_SHAPES).toContain(shape);
      seen.add(shape);
    }
    expect(seen.size).toBe(THUMB_SHAPES.length);
  });

  it('has six shapes', () => {
    expect(THUMB_SHAPES).toHaveLength(6);
  });
});
