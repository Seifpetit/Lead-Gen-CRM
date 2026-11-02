import { inflateRawSync } from 'node:zlib';

// Pure helpers for the French customs regional trade script (npm run trade:tunisia): reading
// the files, finding Tunisia, adding up by region. No network and no files in here, so the
// tests run on small fixtures. The real file layouts were not seen when this was written;
// everything that depends on a header name or a code looks the real one up and says so when
// it cannot find it.

// ---------------------------------------------------------------------------------------
// Text: encodings, separators, numbers

/** UTF-8 when the bytes are valid UTF-8 (a leading BOM is dropped), otherwise Latin-1. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(bytes)
      .replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** "Code région" -> "code region": how headers are compared. */
export function normalizeHeader(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DELIMITERS = [';', '\t', ',', '|'] as const;

/** The separator a file uses, judged from its first line (semicolon wins ties: French files). */
export function detectDelimiter(headerLine: string): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** One line split on `delimiter`, honouring "quoted, fields" and "" for a quote. */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

/** "1 234 567,89" and "1234567.89" and "12.345,6" -> number; null for blank or text. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\s\u00A0\u202F]/g, '');
  if (s === '' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function* lines(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    if (line.trim() !== '') yield line;
    start = end + 1;
  }
}

export interface Table {
  /** Headers as the file spells them. */
  headers: string[];
  /** Headers normalised for matching. */
  keys: string[];
  delimiter: string | null;
}

/** Index of the first header equal to (or, failing that, containing) one of `names`. */
export function findColumn(keys: string[], names: string[]): number {
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i !== -1) return i;
  }
  for (const n of names) {
    const i = keys.findIndex((k) => k.includes(n));
    if (i !== -1) return i;
  }
  return -1;
}

/** Reads a small delimited file into header-keyed rows (the mapping files). */
export function parseTable(text: string): { table: Table; rows: string[][] } {
  const all = [...lines(text)];
  const delimiter = detectDelimiter(all[0] ?? '');
  const headers = delimiter ? splitLine(all[0] ?? '', delimiter) : [all[0] ?? ''];
  const rows = all.slice(1).map((l) => (delimiter ? splitLine(l, delimiter) : [l]));
  return { table: { headers, keys: headers.map(normalizeHeader), delimiter }, rows };
}

// ---------------------------------------------------------------------------------------
// Zip (the dataset ships some files zipped)

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** The files in a zip, read from its central directory. Handles stored and deflated entries. */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('That file is not a zip archive.');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('The zip directory is damaged.');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`The zip uses an unsupported compression (${method}).`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Which of the dataset's files is which

export interface Resource {
  title: string;
  format: string;
  url: string;
}

export interface Mappings {
  departments: Resource;
  countries: Resource;
  products: Resource | null;
}

const label = (r: Resource) => `${r.title} ${r.url}`;
const isDeptRegion = (r: Resource) => /d[eé]partement[\s_-]*r[eé]gion/i.test(label(r));
const isCountries = (r: Resource) => /libell[eé][\s_-]*pays/i.test(label(r));
const isProducts = (r: Resource) => /libell[eé][\s_-]*a?129|a129[\s_-]*libell/i.test(label(r));

/** The name files (departments and regions, countries, and product groups if there is one). */
export function pickMappings(resources: Resource[]): Mappings {
  const need = (test: (r: Resource) => boolean, what: string) => {
    const found = resources.find(test);
    if (!found) throw new Error(`No file for ${what} in the dataset's file list.`);
    return found;
  };
  return {
    departments: need(isDeptRegion, 'the department and region names (Departement_region)'),
    countries: need(isCountries, 'the country names (Libelle_PAYS)'),
    products: resources.find(isProducts) ?? null,
  };
}

/**
 * The regional quarterly data file, chosen by title and format. When it is not clear this
 * throws with the candidates, so a person can pass --data-url.
 */
export function pickData(resources: Resource[]): Resource {
  const candidates = resources
    .filter((r) => ['csv', 'zip'].includes(r.format.trim().toLowerCase()))
    .filter((r) => !isDeptRegion(r) && !isCountries(r) && !isProducts(r))
    .filter((r) => !/nomenclature|notice|lisez|libell/i.test(label(r)));
  const scored = candidates
    .map((r) => {
      const t = normalizeHeader(r.title);
      let score = 0;
      if (/region/.test(t)) score += 3;
      if (/trimestr/.test(t)) score += 2;
      if (/departement/.test(t)) score += 1;
      if (r.format.trim().toLowerCase() === 'csv') score += 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || (scored[1] && scored[1].score === top.score)) {
    const names = scored.map((s) => `  - ${s.r.title} (${s.r.format}) ${s.r.url}`).join('\n');
    throw new Error(
      `Could not tell which file is the regional quarterly data. Candidates:\n${names || '  (none)'}\n` +
        'Pick one and run again with --data-url <address>.',
    );
  }
  return top.r;
}

// ---------------------------------------------------------------------------------------
// Names: countries, departments and regions

/** Code and name pairs from a mapping file, whatever its layout: delimited, or "CODE  NAME". */
export function parseCodeNames(text: string): { code: string; name: string }[] {
  const { table, rows } = parseTable(text);
  const out: { code: string; name: string }[] = [];
  if (table.delimiter) {
    const code = findColumn(table.keys, ['code', 'cod']);
    const name = findColumn(table.keys, ['libelle', 'lib', 'nom', 'name']);
    const c = code === -1 ? 0 : code;
    const n = name === -1 ? 1 : name;
    // A file with no header row has data on its first line: keep it.
    const first = table.headers;
    for (const r of [first, ...rows]) {
      if (r[c] && r[n]) out.push({ code: r[c]!, name: r[n]! });
    }
  } else {
    for (const l of lines(text)) {
      const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(l);
      if (m) out.push({ code: m[1]!, name: m[2]! });
    }
  }
  return out;
}

export interface CountryLookup {
  code: string | null;
  /** Every distinct code whose name looks like Tunisia, for the "ambiguous" message. */
  candidates: { code: string; name: string }[];
}

/** Tunisia's code in the country file. Null when there is not exactly one distinct code. */
export function findTunisia(entries: { code: string; name: string }[]): CountryLookup {
  const candidates = entries.filter((e) => /tunis/i.test(stripAccents(e.name)));
  const codes = new Set(candidates.map((c) => c.code));
  return { code: codes.size === 1 ? [...codes][0]! : null, candidates };
}

export interface RegionNames {
  /** department code -> region code */
  regionOfDepartment: Map<string, string>;
  /** region code -> region name */
  regionName: Map<string, string>;
}

/** Department -> region and region names, found by header; empty maps when the layout is unknown. */
export function parseDepartmentRegion(text: string): RegionNames {
  const { table, rows } = parseTable(text);
  const regionOfDepartment = new Map<string, string>();
  const regionName = new Map<string, string>();
  const k = table.keys;
  const regCode = k.findIndex((h) => /reg/.test(h) && /code|cod/.test(h));
  const regName = k.findIndex((h) => /reg/.test(h) && !/code|cod/.test(h));
  const depCode = k.findIndex((h) => /dep/.test(h) && /code|cod/.test(h));
  for (const r of rows) {
    const reg = regCode === -1 ? undefined : r[regCode];
    if (reg && regName !== -1 && r[regName]) regionName.set(reg, r[regName]!);
    if (reg && depCode !== -1 && r[depCode]) regionOfDepartment.set(r[depCode]!, reg);
  }
  return { regionOfDepartment, regionName };
}

// ---------------------------------------------------------------------------------------
// The trade rows

export type Flow = 'import' | 'export';

export interface TradeRow {
  flow: Flow;
  /** Sortable quarter, like 20243 for the third quarter of 2024. */
  quarter: number;
  regionCode: string;
  productCode: string;
  valueEur: number;
}

export interface ReadResult {
  /** Only the rows for the country asked for. */
  rows: TradeRow[];
  rowsRead: number;
  /** Every quarter the file has, ascending. */
  quarters: number[];
  /** Flow values the file uses, for the error message when they are not recognised. */
  columns: { name: string; at: number }[];
}

export function quarterLabel(q: number): string {
  return `${Math.floor(q / 10)} T${q % 10}`;
}

function flowOf(raw: string): Flow | null {
  const v = stripAccents(raw).trim().toLowerCase();
  if (v === 'i' || v.startsWith('imp')) return 'import';
  if (v === 'e' || v.startsWith('exp')) return 'export';
  return null;
}

/** 2024 + "3" or "T3" -> 20243; or "2024T3" / "2024-Q3" alone. */
function quarterOf(year: string, quarter: string): number | null {
  const q = /([1-4])\s*$/.exec(quarter.trim());
  const y = /(\d{4})/.exec(year);
  if (y && q) return Number(y[1]) * 10 + Number(q[1]);
  const both = /(\d{4}).*?([1-4])/.exec(quarter);
  return both ? Number(both[1]) * 10 + Number(both[2]) : null;
}

/**
 * Reads the regional data file, keeping only the rows for `countryCode`. The header names are
 * looked up, not assumed; if one is missing this throws and names the headers it found. A
 * department is turned into its region when the file has no region column value.
 */
export function readTradeRows(text: string, countryCode: string, regions: RegionNames): ReadResult {
  const iter = lines(text);
  const first = iter.next();
  if (first.done) throw new Error('The data file is empty.');
  const delimiter = detectDelimiter(first.value);
  if (!delimiter)
    throw new Error(`Could not find the separator in the header line: ${first.value}`);
  const headers = splitLine(first.value, delimiter);
  const keys = headers.map(normalizeHeader);
  const at = {
    flux: findColumn(keys, ['flux']),
    trimestre: findColumn(keys, ['trimestre']),
    annee: findColumn(keys, ['annee']),
    departement: findColumn(keys, ['code departement', 'departement']),
    region: findColumn(keys, ['code region', 'region']),
    product: findColumn(keys, ['code a129', 'a129']),
    country: findColumn(keys, ['code pays', 'pays']),
    value: findColumn(keys, ['valeur']),
  };
  const missing = (['flux', 'trimestre', 'country', 'value'] as const).filter((n) => at[n] === -1);
  if (at.region === -1 && at.departement === -1) missing.push('region' as never);
  if (missing.length > 0) {
    throw new Error(
      `The data file has no column for: ${missing.join(', ')}. Its headers are: ${headers.join(' | ')}`,
    );
  }

  const rows: TradeRow[] = [];
  const quarters = new Set<number>();
  const wantedCountry = countryCode.trim().replace(/^0+/, '');
  let rowsRead = 0;
  for (const line of iter) {
    rowsRead++;
    const cells = splitLine(line, delimiter);
    const q = quarterOf(at.annee === -1 ? '' : (cells[at.annee] ?? ''), cells[at.trimestre] ?? '');
    if (q !== null) quarters.add(q);
    if ((cells[at.country] ?? '').replace(/^0+/, '') !== wantedCountry) continue;
    const flow = flowOf(cells[at.flux] ?? '');
    const value = parseNumber(cells[at.value] ?? '');
    if (flow === null || value === null || q === null) continue;
    let region = at.region === -1 ? '' : (cells[at.region] ?? '');
    if (region === '' && at.departement !== -1) {
      region = regions.regionOfDepartment.get(cells[at.departement] ?? '') ?? '';
    }
    rows.push({
      flow,
      quarter: q,
      regionCode: region || '?',
      productCode: at.product === -1 ? '' : (cells[at.product] ?? ''),
      valueEur: value,
    });
  }
  return {
    rows,
    rowsRead,
    quarters: [...quarters].sort((a, b) => a - b),
    columns: headers.map((name, i) => ({ name, at: i })),
  };
}

// ---------------------------------------------------------------------------------------
// Adding up

/** The latest `n` quarters, ascending. */
export function latestQuarters(quarters: number[], n = 4): number[] {
  return [...new Set(quarters)].sort((a, b) => a - b).slice(-n);
}

export interface RegionTotal {
  regionCode: string;
  regionName: string;
  importEur: number;
  exportEur: number;
  totalEur: number;
  /** Share of the national total with the country, 0 to 1. */
  share: number;
}

export function totalsByRegion(
  rows: TradeRow[],
  quarters: number[],
  names: Map<string, string>,
): RegionTotal[] {
  const wanted = new Set(quarters);
  const by = new Map<string, { i: number; e: number }>();
  for (const r of rows) {
    if (!wanted.has(r.quarter)) continue;
    const t = by.get(r.regionCode) ?? { i: 0, e: 0 };
    if (r.flow === 'import') t.i += r.valueEur;
    else t.e += r.valueEur;
    by.set(r.regionCode, t);
  }
  let national = 0;
  for (const t of by.values()) national += t.i + t.e;
  return [...by.entries()]
    .map(([regionCode, t]) => ({
      regionCode,
      regionName: names.get(regionCode) ?? `(region ${regionCode})`,
      importEur: t.i,
      exportEur: t.e,
      totalEur: t.i + t.e,
      share: national > 0 ? (t.i + t.e) / national : 0,
    }))
    .sort((a, b) => b.totalEur - a.totalEur);
}

export interface ProductTotal {
  code: string;
  name: string;
  valueEur: number;
}

export function topProducts(
  rows: TradeRow[],
  quarters: number[],
  flow: Flow,
  names: Map<string, string>,
  limit = 10,
): ProductTotal[] {
  const wanted = new Set(quarters);
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.flow !== flow || !wanted.has(r.quarter)) continue;
    by.set(r.productCode, (by.get(r.productCode) ?? 0) + r.valueEur);
  }
  return [...by.entries()]
    .map(([code, valueEur]) => ({ code, name: names.get(code) ?? '', valueEur }))
    .sort((a, b) => b.valueEur - a.valueEur)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------------------
// Printing

const eur = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const formatEur = (n: number) =>
  `${eur.format(Math.round(n)).replace(/[\u202F\u00A0]/g, ' ')}`;
export const formatShare = (s: number) => `${(s * 100).toFixed(1)} %`;

/** A plain-text table with left-aligned first column and right-aligned numbers. */
export function textTable(headers: string[], body: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? '').length)));
  const row = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  return [row(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(row)].join('\n');
}

/** A CSV cell, quoted when needed. */
export const csvCell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------------------------------------------------------------------------------------
// Eurostat (optional)

export interface EurostatTotals {
  reporter: string;
  year: number;
  importEur: number | null;
  exportEur: number | null;
}

/** The numbers in a JSON-stat answer (an object keyed by position, or an array), summed. */
export function sumJsonStat(body: unknown): number | null {
  const value = (body as { value?: unknown } | null)?.value;
  const nums = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  const clean = nums.filter((n): n is number => typeof n === 'number');
  return clean.length === 0 ? null : clean.reduce((a, b) => a + b, 0);
}

export const EUROSTAT_BASE =
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/DS-045409';

/** The request for one reporter, flow (1 import, 2 export) and year. Dimension names unverified. */
export function eurostatUrl(reporter: string, flow: 1 | 2, year: number): string {
  const q = new URLSearchParams({
    format: 'JSON',
    lang: 'EN',
    reporter,
    partner: 'TN',
    flow: String(flow),
    product: 'TOTAL',
    indicators: 'VALUE_IN_EUROS',
    freq: 'A',
    time: String(year),
  });
  return `${EUROSTAT_BASE}?${q}`;
}
