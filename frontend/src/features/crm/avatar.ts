/** Letters for an avatar: the first letter of the first and of the last word, in capitals. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return '?';
  const letter = (word: string) => Array.from(word.replace(/^[^\p{L}]+/u, ''))[0] ?? '';
  const first = letter(words[0]!);
  const last = words.length > 1 ? letter(words[words.length - 1]!) : '';
  return (first + last).toLocaleUpperCase();
}

/** Light colors, so the black initials always pass WCAG AA. */
export const AVATAR_COLORS = [
  '#ff6b5e',
  '#9b7be9',
  '#3cc8c0',
  '#ffe066',
  '#ff9a55',
  '#4da8e0',
  '#ffc9c2',
] as const;

/** The same name always gets the same color. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLocaleLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
