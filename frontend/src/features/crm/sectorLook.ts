import {
  Apple,
  Armchair,
  BrickWall,
  Cog,
  Droplet,
  Factory,
  FlaskConical,
  Hammer,
  Package,
  Pickaxe,
  Pill,
  Ship,
  ShoppingCart,
  Shirt,
  Store,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

/** The icon and tile color a sector gets when its company has no picture. Fixed per sector. */
export interface SectorLook {
  Icon: LucideIcon;
  /** A light color: the black icon on it passes WCAG AA. */
  color: string;
}

export const DEFAULT_SECTOR_LOOK: SectorLook = { Icon: Factory, color: '#e5e7eb' };

export const SECTOR_LOOKS: Readonly<Record<string, SectorLook>> = {
  'olive-oil': { Icon: Droplet, color: '#c9e265' },
  'agri-food': { Icon: Wheat, color: '#ffe066' },
  'dates-produce': { Icon: Apple, color: '#ff9a55' },
  textile: { Icon: Shirt, color: '#b9a3f0' },
  'construction-materials': { Icon: BrickWall, color: '#ffc9c2' },
  'steel-metal': { Icon: Hammer, color: '#b9c4cc' },
  chemicals: { Icon: FlaskConical, color: '#3cc8c0' },
  'plastics-packaging': { Icon: Package, color: '#7cc0ec' },
  'automotive-parts': { Icon: Cog, color: '#ff8b80' },
  pharma: { Icon: Pill, color: '#f9a8d4' },
  wholesale: { Icon: Store, color: '#a7f3d0' },
  'import-export': { Icon: Ship, color: '#93c5fd' },
  'retail-chains': { Icon: ShoppingCart, color: '#fcd34d' },
  furniture: { Icon: Armchair, color: '#e0b98f' },
  mining: { Icon: Pickaxe, color: '#c4bfb8' },
};

export const sectorLook = (sector: string | null): SectorLook =>
  (sector ? SECTOR_LOOKS[sector] : undefined) ?? DEFAULT_SECTOR_LOOK;
