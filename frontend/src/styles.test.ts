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
const light = tokens(lightBlock);

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

// Text and the surface it sits on. Each must reach WCAG AA (4.5:1).
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
  ['--surface', '--ink'],
  // The colour blocks (card headers, buttons, tabs, badges) carry the main text colour.
  ['--text', '--yellow'],
  ['--text', '--coral'],
  ['--text', '--purple'],
  ['--text', '--teal'],
  ['--text', '--orange'],
  ['--text', '--sky'],
  ['--text', '--blush'],
];

describe('design tokens', () => {
  it('uses the palette, radius, shadows and spacing scale of the design system', () => {
    const palette = {
      '--coral': '#ff6b5e',
      '--purple': '#9b7be9',
      '--teal': '#3cc8c0',
      '--yellow': '#ffe066',
      '--orange': '#ff9a55',
      '--sky': '#4da8e0',
      '--blush': '#ffc9c2',
      '--bg': '#fdf1e8',
      '--ink': '#111111',
      '--surface': '#ffffff',
    };
    for (const [name, value] of Object.entries(palette)) expect(light[name], name).toBe(value);
    expect(light['--radius']).toBe('12px');
    expect(light['--bw']).toBe('2.5px');
    expect(light['--shadow-0']).toBe('none');
    expect(light['--shadow-1']).toBe('4px 4px 0 #111111');
    expect(light['--shadow-2']).toBe('6px 6px 0 #111111');
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

  it('keeps text readable (WCAG AA)', () => {
    for (const [fg, bg] of PAIRS) {
      expect(light[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(light[fg]!, light[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('switches off motion for people who ask for less', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
  });
});

describe('scrollbars', () => {
  it('are thin and invisible until the area is hovered', () => {
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width: 12px/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background: transparent/);
    expect(css).toMatch(/:hover::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scroll-timid\)/);
  });
  it('are bold, black-edged and teal only while focus is inside the area', () => {
    expect(css).toMatch(
      /:focus-within::-webkit-scrollbar-thumb\s*\{[^}]*border: 2px solid var\(--ink\)[^}]*var\(--teal\)/,
    );
  });
  it('give Firefox the same behaviour without hiding the parts from Chrome', () => {
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)[\s\S]*scrollbar-color/);
    expect(css).toMatch(/\*:hover\s*\{[^}]*scrollbar-color: var\(--scroll-timid\)/);
  });
});

describe('focus outline', () => {
  const style = document.createElement('style');
  afterEach(() => {
    style.remove();
    document.body.innerHTML = '';
  });

  it('is a 3px black outline with a white inner edge on buttons, inputs and links', () => {
    // The sheet itself: one rule gives every interactive element the same ring.
    const rule = css.match(/:focus-visible,[\s\S]*?\{([^}]*)\}/)![1]!;
    expect(rule).toContain('outline: 3px solid #111111');
    expect(rule).toContain('box-shadow: 0 0 0 1px #fff');
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
        /^3px solid (#111111|rgb\(17, ?17, ?17\))$/i,
      );
    }
  });
});

describe('light theme only', () => {
  it('has no dark-scheme media query, only a hidden data-theme hook', () => {
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(/:root\[data-theme='dark'\]/);
    expect(lightBlock).toMatch(/color-scheme:\s*light;/);
  });

  it('applies no dark theme when the operating system prefers dark', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).not.toBe('dark');
      expect(light['--bg']).toBe('#fdf1e8');
    } finally {
      window.matchMedia = original;
    }
  });
});

/** The declarations of every rule in the stylesheet with exactly this selector, joined. */
function rule(selector: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [...plain.matchAll(/(?<=^|\})([^{}]+)\{([^}]*)\}/g)].filter(
    (m) => m[1]!.trim() === selector,
  );
  expect(found.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return found.map((m) => m[2]).join('\n');
}

describe('fixed to the window', () => {
  it('makes the frame as tall as the window, with no page scroll', () => {
    expect(rule('#root:has(.topbar)')).toMatch(/height:\s*100dvh/);
    expect(rule('#root:has(.topbar)')).toMatch(/overflow:\s*hidden/);
    expect(rule('html:has(.topbar),\nbody:has(.topbar)')).toMatch(/overflow:\s*hidden/);
  });

  it('scrolls long lists inside their card, under a header that stays', () => {
    expect(rule('.tile-scroll')).toMatch(/overflow(-y)?:\s*auto/);
    expect(rule('.shell-main > .page.dash-page')).toMatch(/overflow:\s*hidden/);
    expect(rule('.fit-body > .widget > .widget-body')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.page-scroll')).toMatch(/overflow-y:\s*auto/);
  });
});

describe('dashboard panel layout', () => {
  it('is one bordered panel with one hard shadow whose sections are split by 2px lines', () => {
    expect(rule('.dash-panel')).toMatch(/box-shadow:/);
    expect(rule('.dash-panel')).toMatch(/container:\s*dashpanel/);
    expect(rule('.panel-section')).toMatch(/min-height:\s*0/);
    expect(rule('.dp-leads')).toMatch(/flex:\s*var\(--dp-top, 61\)/);
    expect(rule('.dp-bottom')).toMatch(/flex:\s*var\(--dp-bottom, 39\)/);
    expect(rule('.panel-head')).toMatch(/height:\s*32px/);
  });

  it('scrolls the card grid and the runs inside their sections', () => {
    expect(rule('.panel-body')).toMatch(/overflow:\s*hidden auto/);
    expect(rule('.panel-body')).toMatch(/min-height:\s*0/);
  });
});

describe('dashboard divider and cards', () => {
  it('colors the divider and its knob, and lets the grid resize it', () => {
    expect(rule('.panel-splitter')).toMatch(/background: var\(--splitter\)/);
    expect(rule('.panel-splitter')).toMatch(/cursor: row-resize/);
    expect(rule('.splitter-knob')).toMatch(/background:/);
    expect(rule('.dp-leads')).toMatch(/flex: var\(--dp-top/);
    expect(rule('.dp-bottom')).toMatch(/flex: var\(--dp-bottom/);
  });
  it('makes cards hop with an overshooting curve, only for people who allow motion', () => {
    expect(css).toMatch(
      /prefers-reduced-motion: no-preference\)\s*\{\s*\.tile\s*\{[^}]*cubic-bezier\(0\.34, 2\.4/,
    );
    expect(css).toMatch(/\.tile:hover\s*\{\s*transform: translateY\(-6px\)/);
    expect(rule('.tile.is-dragging')).toMatch(/opacity/);
  });
  it('gives the sidebar list room for the hard shadow and the count badge', () => {
    expect(css).toMatch(/\.sidebar nav\s*\{[^}]*padding: 4px 8px 8px 4px/);
  });
});

describe('filters panel', () => {
  it('draws the active filters as small chips in one thin scrolling row', () => {
    expect(rule('.filter-chips')).toMatch(/overflow-x:\s*auto/);
    expect(rule('.filter-chip')).toMatch(/height:\s*24px/);
  });
  it('keeps the radio inputs usable by keyboard while the pill is drawn for them', () => {
    expect(rule('.filter-option input')).toMatch(/opacity:\s*0/);
    expect(rule('.filter-option input:focus-visible + span')).toMatch(/outline:\s*3px/);
  });
  it('lets the header of Recent leads stay on one line when there is room', () => {
    expect(css).toMatch(
      /@container dashpanel \(min-width: 640px\)\s*\{\s*\.dp-leads \.panel-head\s*\{[^}]*nowrap/,
    );
  });
});

describe('lead page layout', () => {
  it('fills the window under the top bar and scrolls each column on its own', () => {
    expect(rule('.lead-page > .lead-detail')).toMatch(/min-height:\s*0/);
    expect(rule('.lead-col')).toMatch(/overflow-y:\s*auto/);
    expect(rule(".lead-col-right [role='tabpanel']")).toMatch(/overflow-y:\s*auto/);
    expect(rule('.lead-columns')).toMatch(/grid-template-columns:\s*2fr 3fr/);
  });

  it('stacks the columns on narrow windows and scrolls the card body instead', () => {
    const narrow = css.slice(css.lastIndexOf('@media (max-width: 900px)'));
    expect(narrow).toMatch(/\.lead-detail > \.widget-body \{[^}]*overflow-y:\s*auto/);
    expect(narrow).toMatch(/\.lead-columns \{[^}]*display:\s*block/);
  });
});

describe('coverage map drawing', () => {
  /** The declarations of the last rule whose selector list contains exactly `selector`. */
  function rule(selector: string): Record<string, string> {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let found: Record<string, string> | null = null;
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of plain.matchAll(re)) {
      const selectors = m[1]!.split(',').map((s) => s.trim());
      if (!selectors.includes(selector)) continue;
      found = { ...(found ?? {}) };
      for (const d of m[2]!.matchAll(/([\w-]+):\s*([^;]+);/g)) found[d[1]!] = d[2]!.trim();
    }
    if (!found) throw new Error(`No rule for ${selector}`);
    return found;
  }

  it('fills a search square only by its state: never searched has no fill', () => {
    expect(['none', 'transparent']).toContain(rule('.map-cell').fill);
    expect(['none', 'transparent']).toContain(rule('.map-cell.cell-never').fill);
    for (const state of ['claimed', 'searched', 'leads', 'saturated']) {
      const fill = rule(`.map-cell.cell-${state}`).fill!;
      // A real, light colour (an SVG shape with no fill is black), and see-through.
      expect(fill, state).toMatch(/^#[0-9a-f]{6}$/i);
      expect(luminance(fill), state).toBeGreaterThan(0.25);
      expect(Number(rule(`.map-cell.cell-${state}`)['fill-opacity']), state).toBeLessThan(1);
    }
  });

  it('draws the squares as thin, light grid lines', () => {
    const cell = rule('.map-cell');
    expect(Number(cell['stroke-width'])).toBeLessThanOrEqual(1);
    expect(Number(cell['stroke-opacity'])).toBeLessThanOrEqual(0.3);
    expect(cell['vector-effect']).toBe('non-scaling-stroke');
  });

  it('puts no browser focus rectangle around a region or a square', () => {
    for (const selector of [
      '.coverage-map [tabindex]:focus',
      '.coverage-map [tabindex]:focus-visible',
    ]) {
      expect(rule(selector).outline, selector).toBe('none');
      expect(rule(selector)['box-shadow'], selector).toBe('none');
    }
    // Keyboard focus shows on the outline of the shape itself.
    expect(rule('.region-shape:focus-visible').stroke).toBeTruthy();
  });

  it('highlights the picked square and region with an outline colour, not black', () => {
    expect(rule('.map-cell.is-selected').stroke).not.toMatch(/black|ink|#000|#111/);
  });
});
