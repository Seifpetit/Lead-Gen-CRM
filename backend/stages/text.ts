import { normalizeTitle } from '../config/titles.js';

/** Accent-free, lowercase, punctuation as spaces, padded for whole-phrase matching. */
export function padded(text: string | null | undefined): string {
  return ` ${normalizeTitle(text ?? '')} `;
}

/** The first phrase (normalized the same way) found as whole words in the padded text. */
export function findPhrase(paddedText: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    const p = normalizeTitle(phrase);
    if (p !== '' && paddedText.includes(` ${p} `)) return phrase;
  }
  return null;
}
