// Just enough of the Unicode bidirectional algorithm to lay out a table cell that mixes Arabic
// and Latin text, a word at a time. Each word is drawn on its own: the PDF font engine already
// shapes an Arabic word and writes its letters right to left; what it cannot do is put the
// words of a line in the right order, which is what this decides. Pure.

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

/** True when the first strong letter of the text is Arabic (or Hebrew): it reads right to left. */
export function isRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL_LETTER.test(ch)) return true;
    if (LETTER.test(ch)) return false;
  }
  return false;
}

type Kind = 'rtl' | 'ltr' | 'number' | 'neutral';

function kindOf(word: string): Kind {
  if (RTL_LETTER.test(word)) return 'rtl';
  if (LETTER.test(word)) return 'ltr';
  if (DIGIT.test(word)) return 'number';
  return 'neutral';
}

/**
 * The words of one line (in reading order) in the order they are drawn from left to right.
 * Levels follow the bidi rules: Arabic words are 1, Latin words 0 (2 inside a right-to-left
 * line), numbers take the level that keeps them left to right, and punctuation between two
 * Arabic words joins them. Runs are then reversed from the highest level down.
 */
export function visualOrder(words: readonly string[], rtlBase: boolean): string[] {
  const kinds = words.map(kindOf);
  const strongAround = (i: number, step: -1 | 1): 'rtl' | 'ltr' => {
    for (let j = i + step; j >= 0 && j < kinds.length; j += step) {
      const k = kinds[j];
      if (k === 'rtl' || k === 'ltr') return k;
    }
    return rtlBase ? 'rtl' : 'ltr';
  };
  const levels = kinds.map((kind, i) => {
    if (kind === 'rtl') return 1;
    if (kind === 'ltr') return rtlBase ? 2 : 0;
    const before = strongAround(i, -1);
    const after = strongAround(i, 1);
    const inRtl = before === 'rtl' && after === 'rtl';
    if (kind === 'number') return rtlBase || before === 'rtl' || inRtl ? 2 : 0;
    if (inRtl) return 1;
    if (before === 'ltr' && after === 'ltr') return rtlBase ? 2 : 0;
    return rtlBase ? 1 : 0;
  });

  const order = words.map((_, i) => i);
  const max = Math.max(0, ...levels);
  for (let level = max; level >= 1; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]!]! < level) {
        i++;
        continue;
      }
      let end = i;
      while (end < order.length && levels[order[end]!]! >= level) end++;
      order.splice(i, end - i, ...order.slice(i, end).reverse());
      i = end;
    }
  }
  return order.map((i) => words[i]!);
}
