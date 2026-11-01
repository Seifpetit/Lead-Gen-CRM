import {
  DEV_LIMITS,
  type CountryCode,
  type DevArea,
  type DevClassifyInput,
  type DevDiscoverInput,
  type DevDiscoverOutput,
  type DevOptions,
} from '@lead-gen-crm/shared';
import { parseAmount } from '../../lib/parseAmount.js';

// What the developer console's forms hold, and how that becomes the request the server checks.
// Pure: the page only draws these.

export type AreaKind = DevArea['kind'];

export interface DiscoverForm {
  country: CountryCode;
  language: 'fr' | 'en';
  words: string[];
  areaKind: AreaKind;
  regionId: string;
  cellKey: string;
  rect: { south: string; west: string; north: string; east: string };
  maxPlaces: string;
  capUsd: string;
}

export interface CompanyRow {
  name: string;
  category: string;
  website: string;
  text: string;
}

export interface ClassifyForm {
  country: CountryCode;
  rows: CompanyRow[];
  capUsd: string;
}

export type FormProblem =
  'words' | 'region' | 'cell' | 'rect' | 'places' | 'cap' | 'companies' | 'name';

const usdText = (n: number) => n.toFixed(2);

/** The first region of a country that has cells, else the first region, for a fresh form. */
export function defaultArea(options: DevOptions, country: CountryCode) {
  const own = options.areas.filter((a) => a.country === country);
  const region = own.find((a) => a.cells.length > 0) ?? own[0];
  return { regionId: region?.regionId ?? '', cellKey: region?.cells[0]?.cellKey ?? '' };
}

export function languagesOf(options: DevOptions, country: CountryCode): ('fr' | 'en')[] {
  const found = options.countries.find((c) => c.code === country)?.languages ?? [];
  return found.length > 0 ? found : ['fr'];
}

export function defaultDiscover(options: DevOptions, country: CountryCode): DiscoverForm {
  const area = defaultArea(options, country);
  return {
    country,
    language: languagesOf(options, country)[0]!,
    words: [],
    areaKind: area.cellKey ? 'cell' : 'region',
    ...area,
    rect: { south: '', west: '', north: '', east: '' },
    maxPlaces: String(DEV_LIMITS.defaultPlacesPerSearch),
    capUsd: usdText(DEV_LIMITS.discoverCapDefaultUsd),
  };
}

export function defaultClassify(country: CountryCode): ClassifyForm {
  return { country, rows: [blankRow()], capUsd: usdText(DEV_LIMITS.classifyCapDefaultUsd) };
}

export const blankRow = (): CompanyRow => ({ name: '', category: '', website: '', text: '' });

const num = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};

/** The request for the server, or what is wrong with the form (nothing is sent while it is wrong). */
export function discoverRequest(
  form: DiscoverForm,
): { input: DevDiscoverInput } | { problem: FormProblem } {
  if (form.words.length === 0 || form.words.length > DEV_LIMITS.maxWords)
    return { problem: 'words' };
  const places = parseAmount(form.maxPlaces);
  if (
    places === null ||
    !Number.isInteger(places) ||
    places < 1 ||
    places > DEV_LIMITS.maxPlacesPerSearch
  ) {
    return { problem: 'places' };
  }
  const cap = parseAmount(form.capUsd);
  if (cap === null || cap < DEV_LIMITS.discoverCapMinUsd || cap > DEV_LIMITS.discoverCapMaxUsd) {
    return { problem: 'cap' };
  }
  let area: DevArea;
  if (form.areaKind === 'rect') {
    const [south, west, north, east] = [
      num(form.rect.south),
      num(form.rect.west),
      num(form.rect.north),
      num(form.rect.east),
    ];
    if (south === null || west === null || north === null || east === null) {
      return { problem: 'rect' };
    }
    if (!(south < north) || !(west < east)) return { problem: 'rect' };
    area = { kind: 'rect', south, west, north, east };
  } else if (form.areaKind === 'region') {
    if (!form.regionId) return { problem: 'region' };
    area = { kind: 'region', regionId: form.regionId };
  } else {
    if (!form.regionId) return { problem: 'region' };
    if (!form.cellKey) return { problem: 'cell' };
    area = { kind: 'cell', regionId: form.regionId, cellKey: form.cellKey };
  }
  return {
    input: {
      country: form.country,
      language: form.language,
      words: form.words,
      area,
      maxPlaces: places,
      capUsd: cap,
    },
  };
}

/** Rows with a name only count; a half-filled blank row at the end is ignored. */
export function classifyRequest(
  form: ClassifyForm,
): { input: DevClassifyInput } | { problem: FormProblem } {
  const rows = form.rows.filter(
    (r) =>
      r.name.trim() !== '' ||
      r.category.trim() !== '' ||
      r.website.trim() !== '' ||
      r.text.trim() !== '',
  );
  if (rows.length === 0 || rows.length > DEV_LIMITS.maxCompanies) return { problem: 'companies' };
  if (rows.some((r) => r.name.trim() === '')) return { problem: 'name' };
  const cap = parseAmount(form.capUsd);
  if (cap === null || cap <= 0 || cap > DEV_LIMITS.classifyCapMaxUsd) return { problem: 'cap' };
  return {
    input: {
      country: form.country,
      capUsd: cap,
      companies: rows.map((r) => ({
        name: r.name.trim(),
        ...(r.category.trim() ? { category: r.category.trim() } : {}),
        ...(r.website.trim() ? { website: r.website.trim() } : {}),
        ...(r.text.trim() ? { text: r.text.trim() } : {}),
      })),
    },
  };
}

/** A past Discover call put back in the form (it is not run). */
export function discoverFormFrom(input: DevDiscoverInput): DiscoverForm {
  const a = input.area;
  return {
    country: input.country,
    language: input.language,
    words: [...input.words],
    areaKind: a.kind,
    regionId: a.kind === 'rect' ? '' : a.regionId,
    cellKey: a.kind === 'cell' ? a.cellKey : '',
    rect:
      a.kind === 'rect'
        ? {
            south: String(a.south),
            west: String(a.west),
            north: String(a.north),
            east: String(a.east),
          }
        : { south: '', west: '', north: '', east: '' },
    maxPlaces: String(input.maxPlaces),
    capUsd: usdText(input.capUsd),
  };
}

export function classifyFormFrom(input: DevClassifyInput): ClassifyForm {
  return {
    country: input.country,
    capUsd: usdText(input.capUsd),
    rows: input.companies.map((c) => ({
      name: c.name,
      category: c.category ?? '',
      website: c.website ?? '',
      text: c.text ?? '',
    })),
  };
}

/** The places of a Discover result as classifier rows, one per distinct place, at most 20. */
export function rowsFromPlaces(output: DevDiscoverOutput): CompanyRow[] {
  const seen = new Set<string>();
  const rows: CompanyRow[] = [];
  for (const p of output.places) {
    const key = `${p.name}|${p.address ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: p.name,
      category: p.category ?? '',
      website: p.website ?? '',
      text: '',
    });
  }
  return rows.slice(0, DEV_LIMITS.maxCompanies);
}

/** A word typed into the chips box, tidied; null when it adds nothing. */
export function addWord(words: readonly string[], typed: string): string[] | null {
  const word = typed.replace(/\s+/g, ' ').trim();
  if (word === '' || word.length > DEV_LIMITS.maxWordChars) return null;
  if (words.length >= DEV_LIMITS.maxWords) return null;
  if (words.some((w) => w.toLocaleLowerCase() === word.toLocaleLowerCase())) return null;
  return [...words, word];
}
