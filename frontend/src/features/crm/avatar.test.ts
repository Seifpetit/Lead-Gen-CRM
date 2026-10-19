import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor, initialsOf } from './avatar.js';
import { DEFAULT_SECTOR_LOOK, SECTOR_LOOKS, sectorLook } from './sectorLook.js';

/** WCAG contrast of black text on a #rrggbb color. */
function contrastWithBlack(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return (luminance + 0.05) / 0.05;
}

describe('avatar initials', () => {
  it('takes the first letter of the first and of the last word', () => {
    expect(initialsOf('Amel Ben Salah')).toBe('AS');
    expect(initialsOf('amel salah')).toBe('AS');
    expect(initialsOf('  Mohamed   Ali  ')).toBe('MA');
  });

  it('uses one letter for a single word, and handles accents and other scripts', () => {
    expect(initialsOf('Amel')).toBe('A');
    expect(initialsOf('émile zola')).toBe('ÉZ');
    expect(initialsOf('محمد علي')).toBe('مع');
  });

  it('skips marks that are not letters, and falls back to a question mark', () => {
    expect(initialsOf('(Dr.) Amel - Salah')).toBe('DS');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('123 456')).toBe('?');
  });
});

describe('avatar colors', () => {
  it('gives the same name the same color, whatever the case or spaces', () => {
    expect(avatarColor('Amel Ben Salah')).toBe(avatarColor('  amel ben salah '));
  });

  it('spreads names over the palette and only uses colors black text can sit on', () => {
    const names = ['Amel', 'Karim', 'Sonia', 'Youssef', 'Leila', 'Nabil', 'Ines', 'Hedi', 'Rim'];
    const used = new Set(names.map(avatarColor));
    expect(used.size).toBeGreaterThan(2);
    for (const color of used) expect(AVATAR_COLORS).toContain(color);
    for (const color of AVATAR_COLORS) expect(contrastWithBlack(color)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('sector looks', () => {
  const EXPECTED: Record<string, string> = {
    'olive-oil': 'Droplet',
    'agri-food': 'Wheat',
    'dates-produce': 'Apple',
    textile: 'Shirt',
    'construction-materials': 'BrickWall',
    'steel-metal': 'Hammer',
    chemicals: 'FlaskConical',
    'plastics-packaging': 'Package',
    'automotive-parts': 'Cog',
    pharma: 'Pill',
    wholesale: 'Store',
    'import-export': 'Ship',
    'retail-chains': 'ShoppingCart',
    furniture: 'Armchair',
    mining: 'Pickaxe',
  };

  it('gives each sector its own icon and color', () => {
    expect(Object.keys(SECTOR_LOOKS).sort()).toEqual(Object.keys(EXPECTED).sort());
    const icons = new Set(Object.values(SECTOR_LOOKS).map((l) => l.Icon));
    expect(icons.size).toBe(Object.keys(EXPECTED).length);
    for (const id of Object.keys(EXPECTED)) expect(sectorLook(id)).toBe(SECTOR_LOOKS[id]);
  });

  it('uses the factory for an unknown or missing sector', () => {
    expect(sectorLook(null)).toBe(DEFAULT_SECTOR_LOOK);
    expect(sectorLook('something-new')).toBe(DEFAULT_SECTOR_LOOK);
  });

  it('puts only colors black can be read on behind the icons', () => {
    for (const look of [...Object.values(SECTOR_LOOKS), DEFAULT_SECTOR_LOOK]) {
      expect(contrastWithBlack(look.color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
