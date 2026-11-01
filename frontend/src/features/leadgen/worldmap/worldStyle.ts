import type { MapPin, TradeRole } from '@lead-gen-crm/shared';

/** Colours of the world map, in the app's palette (light only). */
export const WORLD = {
  ocean: '#cfe8f7',
  supported: '#e4e4e4',
  supportedHover: '#f4f4f4',
  unsupported: '#8d8d8d',
  line: '#111111',
  selected: '#ffd23f',
  regionNone: '#f1f1f1',
  regionActive: '#9be0d6',
  regionSaturated: '#c9b3f2',
  regionHover: '#ffd23f',
} as const;

/** The colour of a region on the map by how far it is explored, for the dots in the region list. */
export const TONE_COLORS = {
  none: WORLD.regionNone,
  active: WORLD.regionActive,
  saturated: WORLD.regionSaturated,
} as const;

export const PIN_COLORS: Record<TradeRole | 'none', string> = {
  exporter: '#ff6b57',
  importer: '#2ec4b6',
  both: '#9b5de5',
  trader: '#ffd23f',
  not_import_export: '#ffffff',
  unclear: '#ffffff',
  competitor_or_partner: '#ffffff',
  none: '#ffffff',
};

export const pinColor = (pin: Pick<MapPin, 'tradeRole'>): string =>
  PIN_COLORS[pin.tradeRole ?? 'none'];

/** The camera when no country is picked: the whole world, a little north-heavy. */
export const WORLD_VIEW = { center: [22, 12] as [number, number], zoom: 2 };
