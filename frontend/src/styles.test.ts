import css from './styles.css?inline';
import { afterEach, describe, expect, it } from 'vitest';

/** The custom properties declared in a block of CSS, with var(--x) references resolved. */
function tokens(block: string, inherited: Record<string, string> = {}): Record<string, string> {
  const out = { ...inherited };
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  const resolve = (v: string): string =>
    v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(out[name] ?? ''));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, resolve(v)]));
}

const rootStart = css.indexOf(':root {');
const lightBlock = css.slice(rootStart, css.indexOf('\n}\n', rootStart));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('\n  }\n}', darkStart));
const light = tokens(lightBlock);
const dark = tokens(darkBlock, light);

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Text and the surface it sits on, in both themes. Each must reach WCAG AA (4.5:1).
const PAIRS: [string, string][] = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--muted', '--bg'],
  ['--muted', '--surface'],
  ['--accent-ink', '--surface'],
  ['--accent-ink', '--bg'],
  ['--accent-text', '--accent'],
  ['--danger-text', '--surface'],
  ['--danger-text', '--bg'],
  ['--ok', '--ok-bg'],
  ['--warning', '--warning-bg'],
  ['--text', '--accent-tint'],
];

describe('design tokens', () => {
  it('uses the palette, radius, shadows and spacing scale of the design system', () => {
    expect(light['--teal']).toBe('#00c2cb');
    expect(light['--magenta']).toBe('#ff00ff');
    expect(light['--yellow']).toBe('#ffe600');
    expect(light['--paper']).toBe('#f5f0e1');
    expect(light['--bg']).toBe('#f5f0e1');
    expect(light['--radius']).toBe('6px');
    expect(light['--shadow-0']).toBe('none');
    expect(light['--shadow-1']).toBe('3px 3px 0 #000000');
    expect(light['--shadow-2']).toBe('6px 6px 0 #000000');
    expect([1, 2, 3, 4, 5, 6, 7].map((i) => light[`--space-${i}`])).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
      '48px',
    ]);
    expect(['h1', 'h2', 'h3', 'h4', 'body', 'caption'].map((k) => light[`--fs-${k}`])).toEqual([
      '32px',
      '24px',
      '20px',
      '16px',
      '15px',
      '13px',
    ]);
    expect(light['--font']).toMatch(/^'Space Grotesk'/);
  });

  for (const [theme, set] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`keeps text readable (WCAG AA) in ${theme} mode`, () => {
      for (const [fg, bg] of PAIRS) {
        expect(set[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
        expect(set[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(set[fg]!, set[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('puts black text on the colour blocks (teal, yellow, magenta)', () => {
    for (const block of ['--teal', '--yellow', '--magenta']) {
      expect(contrast('#000000', light[block]!), block).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has a near-black page in dark mode with light borders', () => {
    expect(luminance(dark['--bg']!)).toBeLessThan(0.02);
    expect(luminance(dark['--border']!)).toBeGreaterThan(0.7);
  });

  it('switches off motion for people who ask for less', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
  });
});

describe('focus outline', () => {
  const style = document.createElement('style');
  afterEach(() => {
    style.remove();
    document.body.innerHTML = '';
  });

  it('is a 3px yellow outline with a black inner edge on buttons, inputs and links', () => {
    // The sheet itself: one rule gives every interactive element the same ring.
    const rule = css.match(/:focus-visible,[\s\S]*?\{([^}]*)\}/)![1]!;
    expect(rule).toContain('outline: 3px solid #ffe600');
    expect(rule).toContain('box-shadow: 0 0 0 1px #000');
    for (const selector of ['button:focus-visible', 'input:focus-visible', 'a:focus-visible']) {
      expect(css).toContain(selector);
    }
  });

  it('renders on a focused button and input', () => {
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML =
      '<button type="button" class="button">Go</button><input aria-label="Name" />';
    const button = document.querySelector('button')!;
    const input = document.querySelector('input')!;
    for (const el of [button, input]) {
      el.focus();
      const computed = getComputedStyle(el);
      // jsdom reports the shorthand only.
      expect(computed.outline.replace(/\s+/g, ' '), el.tagName).toMatch(
        /^3px solid (#ffe600|rgb\(255, ?230, ?0\))$/i,
      );
    }
  });
});
