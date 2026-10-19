/** The outlines a company's fallback tile can take. Decoration only: the name stays the identifier. */
export const THUMB_SHAPES = [
  'circle',
  'squircle',
  'rounded',
  'hexagon',
  'diamond',
  'shield',
] as const;
export type ThumbShape = (typeof THUMB_SHAPES)[number];

/** FNV-1a: the same text always gives the same number, on every visit and in every browser. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The shape of a company's tile, fixed by its id so it never changes between renders. */
export function thumbShape(companyId: string): ThumbShape {
  return THUMB_SHAPES[hashText(companyId) % THUMB_SHAPES.length]!;
}
