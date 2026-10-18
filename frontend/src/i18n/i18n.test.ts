import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { translate } from './index.js';

describe('translate', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'run.title', { region: 'Sfax' })).toBe('Run in Sfax');
    expect(translate('en', 'run.title')).toBe('Run in {region}');
  });

  it('has the same placeholders in every use of a string', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text, key).not.toMatch(/\{\s|\s\}/);
    }
  });
});

// Component sources as text (Vite reads them; the tests never run them).
const components = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('user-facing text', () => {
  it('scans the component sources', () => {
    expect(Object.keys(components).length).toBeGreaterThan(15);
  });

  it('lives in the strings file, not in components', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(components)) {
      // Generic type arguments (Promise<void>) look like tags; drop them first.
      const code = source.replace(/\b[A-Z]\w*<[^<>()]*>/g, 'T');
      // Text between JSX tags that is not an expression, e.g. <p>Hello</p>.
      for (const m of code.matchAll(/>\s*([A-Za-z][A-Za-z ,.'!?-]{2,})\s*<\/?[A-Za-z]/g)) {
        offenders.push(`${file}: "${m[1]}"`);
      }
      // Literal text props that people read.
      for (const m of code.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)) {
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
