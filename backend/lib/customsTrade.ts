// Pure helpers for the French customs national trade script (npm run trade:tunisia): reading
// the files, finding Tunisia, adding up goods by month. No network and no files in here, so the
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

/** True when the bytes are valid UTF-8 (used on the start of a big file to pick how to read it). */
export function looksUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
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
// Names: countries, departments and regions

/** Code and name pairs from a mapping file, whatever its layout: delimited, or "CODE  NAME". */
export function parseCodeNames(text: string): { code: string; name: string }[] {
  const { table, rows } = parseTable(text);
  const out: { code: string; name: string }[] = [];
  if (table.delimiter) {
    const code = findColumn(table.keys, ['code', 'cod']);
    const frenchKeys = table.keys.map((k) => (/angl|engl|english/.test(k) ? '' : k));
    const name = findColumn(frenchKeys, ['libelle', 'lib', 'nom', 'name']);
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

// ---------------------------------------------------------------------------------------
// Which of the dataset's files is which: by title (the dataset's own file names)

export interface Resource {
  title: string;
  format: string;
  url: string;
  /** Bytes, as the dataset states it; null when it does not. */
  size: number | null;
}

const megabytes = (n: number | null) =>
  n === null
    ? 'size not stated'
    : n < 1e6
      ? `${Math.max(1, Math.round(n / 1e3))} KB`
      : `${(n / 1e6).toFixed(1)} MB`;

/** Every file of the dataset, as the script prints it before doing anything else. */
export function formatResourceList(resources: Resource[]): string {
  return textTable(
    ['#', 'Title', 'Format', 'Size'],
    resources.map((r, i) => [
      String(i + 1),
      r.title || '(no title)',
      r.format || '?',
      megabytes(r.size),
    ]),
    3,
  );
}

export interface LabelFiles {
  countries: Resource;
  /** Product group (A129) names; null when the dataset has none. */
  groups: Resource | null;
  /** Detailed product (NC8) names, the newest year; null when the dataset has none. */
  products: Resource | null;
}

const slug = (r: Resource) => stripAccents(`${r.title} ${r.url}`).toLowerCase();
const isZip = (r: Resource) => /zip/i.test(r.format) || /\.zip(\?|$)/i.test(r.url);
const isCsv = (r: Resource) =>
  !isZip(r) && (/csv/i.test(r.format) || /\.csv(\?|$)|\/exports\/csv(\?|$)/i.test(r.url));

/** The name files (countries, product groups, products), picked by title. Zips are ignored. */
export function pickLabelFiles(resources: Resource[]): LabelFiles {
  const labelFile = (test: RegExp) => resources.filter((r) => isCsv(r) && test.test(slug(r)));
  const countries = labelFile(/libelle[-_ ]*pays/)[0];
  if (!countries)
    throw new Error('No "libelle-PAYS" csv in the dataset: Tunisia\'s code cannot be looked up.');
  const nc8 = labelFile(/libelle[-_ ]*nc8/)
    .map((r) => ({
      r,
      year: Number(/(\d{4})/.exec(slug(r).replace(/.*libelle[-_ ]*nc8/, ''))?.[1] ?? 0),
    }))
    .sort((a, b) => b.year - a.year)[0];
  return {
    countries,
    groups: labelFile(/libelle[-_ ]*a129/)[0] ?? null,
    products: nc8?.r ?? null,
  };
}

/**
 * The national monthly file. Zips are ignored. Among the csv files of the national dataset, the
 * one whose address is the dataset's export (…/exports/csv) wins; if several remain, the one
 * with use_labels=true. Throws, listing the files, when that does not leave exactly one.
 * (Not used when --data-url gives the address.)
 */
export function pickDataFile(resources: Resource[]): Resource {
  const national = resources.filter(
    (r) =>
      isCsv(r) && /statistiques[-_ ]nationales[-_ ]du[-_ ]commerce[-_ ]exterieur/.test(slug(r)),
  );
  const exports_ = national.filter((r) => /\/exports\/csv(\?|$)/i.test(r.url));
  let pool = exports_.length > 0 ? exports_ : national;
  if (pool.length > 1) {
    const labelled = pool.filter((r) => /[?&]use_labels=true(&|$)/i.test(r.url));
    if (labelled.length > 0) pool = labelled;
  }
  if (pool.length !== 1) {
    const names = resources.map((r) => `  - ${r.title} (${r.format}) ${r.url}`).join('\n');
    throw new Error(
      `${pool.length === 0 ? 'No file' : 'More than one file'} looks like the national monthly csv. Files found:\n${names}\n` +
        'Pick one and run again with --data-url <address>.',
    );
  }
  return pool[0]!;
}

/** The data file: exactly the address from --data-url when given (no picking at all), else the picked one. */
export function chooseDataFile(resources: Resource[], dataUrl: string | null): Resource {
  if (dataUrl !== null) {
    return { title: 'chosen with --data-url', format: 'csv', url: dataUrl, size: null };
  }
  return pickDataFile(resources);
}

// ---------------------------------------------------------------------------------------
// Labels

/** code -> name, also reachable without leading zeros (a spreadsheet may have dropped them). */
export function labelMap(entries: { code: string; name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    map.set(e.code, e.name);
    const bare = e.code.replace(/^0+/, '');
    if (!map.has(bare)) map.set(bare, e.name);
  }
  return map;
}

export const labelOf = (map: Map<string, string>, code: string): string =>
  map.get(code) ?? map.get(code.replace(/^0+/, '')) ?? '';

// ---------------------------------------------------------------------------------------
// The national monthly rows, read one line at a time

export type Flow = 'import' | 'export';

function flowOf(raw: string): Flow | null {
  const v = stripAccents(raw).trim().toLowerCase();
  if (v === 'i' || v.startsWith('imp')) return 'import';
  if (v === 'e' || v.startsWith('exp')) return 'export';
  return null;
}

/** Year and month -> 202403. The month may be "3", "03" or "2024-03". */
function monthOf(year: string, month: string): number | null {
  const m = /^\s*(\d{1,2})\s*$/.exec(month);
  const y = /(\d{4})/.exec(year);
  if (m && y) return Number(y[1]) * 100 + Number(m[1]);
  const both = /(\d{4})\D+(\d{1,2})/.exec(month);
  return both ? Number(both[1]) * 100 + Number(both[2]) : null;
}

export const monthLabel = (m: number) =>
  `${Math.floor(m / 100)}-${String(m % 100).padStart(2, '0')}`;

export interface Good {
  flow: Flow;
  month: number;
  nc8: string;
  group: string;
  valueEur: number;
  massKg: number;
}

/**
 * Adds up the national file line by line, keeping only the country asked for, so the whole file
 * never sits in memory. The first line is the header: its names are looked up, and if one
 * needed is missing this throws and names the headers it found.
 */
export class NationalReader {
  readonly delimiter: string;
  private readonly at: Record<
    'flux' | 'mois' | 'annee' | 'a129' | 'nc8' | 'pays' | 'valeur' | 'masse',
    number
  >;
  /** Rows read, and rows per month (to tell a half-filled last month). */
  rowsRead = 0;
  readonly monthRows = new Map<number, number>();
  /** Rows for the country whose flow was not import or export, or whose number was unreadable. */
  skipped = 0;
  private readonly goods = new Map<string, Good>();
  private readonly country: string;

  constructor(headerLine: string, countryCode: string) {
    const delimiter = detectDelimiter(headerLine);
    if (!delimiter)
      throw new Error(`Could not find the separator in the header line: ${headerLine}`);
    this.delimiter = delimiter;
    const headers = splitLine(headerLine, delimiter);
    const keys = headers.map(normalizeHeader);
    const at = {
      flux: findColumn(keys, ['flux']),
      mois: findColumn(keys, ['mois']),
      annee: findColumn(keys, ['annee']),
      a129: findColumn(keys, ['code a129', 'a129']),
      nc8: findColumn(keys, ['code nc8', 'nc8']),
      pays: findColumn(keys, ['code pays', 'pays']),
      valeur: findColumn(keys, ['valeur']),
      masse: findColumn(keys, ['masse']),
    };
    const missing = Object.entries(at)
      .filter(([, i]) => i === -1)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `The data file has no column for: ${missing.join(', ')}. Its headers are: ${headers.join(' | ')}`,
      );
    }
    this.at = at;
    this.country = countryCode.trim().replace(/^0+/, '');
  }

  add(line: string): void {
    this.rowsRead++;
    const c = splitLine(line, this.delimiter);
    const month = monthOf(c[this.at.annee] ?? '', c[this.at.mois] ?? '');
    if (month !== null) this.monthRows.set(month, (this.monthRows.get(month) ?? 0) + 1);
    if ((c[this.at.pays] ?? '').replace(/^0+/, '') !== this.country) return;
    const flow = flowOf(c[this.at.flux] ?? '');
    const value = parseNumber(c[this.at.valeur] ?? '');
    if (flow === null || value === null || month === null) {
      this.skipped++;
      return;
    }
    const nc8 = c[this.at.nc8] ?? '';
    const group = c[this.at.a129] ?? '';
    const key = `${flow}|${month}|${nc8}|${group}`;
    const g = this.goods.get(key) ?? { flow, month, nc8, group, valueEur: 0, massKg: 0 };
    g.valueEur += value;
    g.massKg += parseNumber(c[this.at.masse] ?? '') ?? 0;
    this.goods.set(key, g);
  }

  get rows(): Good[] {
    return [...this.goods.values()];
  }
}

// ---------------------------------------------------------------------------------------
// Adding up

export interface MonthChoice {
  /** The months used, ascending. */
  months: number[];
  /** The last month in the file when it looked half-filled and was left out, else null. */
  leftOut: number | null;
}

/**
 * The latest `n` months in the file. The newest is left out when it has less than half the rows
 * of the months before it, which is what a month still being filled looks like.
 */
export function latestMonths(monthRows: Map<number, number>, n = 12): MonthChoice {
  const all = [...monthRows.keys()].sort((a, b) => a - b);
  let leftOut: number | null = null;
  const last = all[all.length - 1];
  if (last !== undefined && all.length >= 2) {
    const before = all.slice(-4, -1).map((m) => monthRows.get(m) ?? 0);
    const typical = before.reduce((a, b) => a + b, 0) / before.length;
    if ((monthRows.get(last) ?? 0) < typical / 2) {
      leftOut = last;
      all.pop();
    }
  }
  return { months: all.slice(-n), leftOut };
}

export interface GoodTotal {
  code: string;
  name: string;
  valueEur: number;
  /** Share of the direction's total value, 0 to 1. */
  share: number;
  massKg: number;
}

export interface Summary {
  totalEur: number;
  goods: GoodTotal[];
  groups: GoodTotal[];
}

/** Top goods (NC8) and top product groups (A129) for one direction over the months chosen. */
export function summarize(
  rows: Good[],
  months: number[],
  flow: Flow,
  productNames: Map<string, string>,
  groupNames: Map<string, string>,
  goodsLimit = 20,
  groupsLimit = 10,
): Summary {
  const wanted = new Set(months);
  const byGood = new Map<string, { v: number; kg: number }>();
  const byGroup = new Map<string, { v: number; kg: number }>();
  let total = 0;
  const bump = (m: Map<string, { v: number; kg: number }>, k: string, g: Good) => {
    const t = m.get(k) ?? { v: 0, kg: 0 };
    t.v += g.valueEur;
    t.kg += g.massKg;
    m.set(k, t);
  };
  for (const g of rows) {
    if (g.flow !== flow || !wanted.has(g.month)) continue;
    total += g.valueEur;
    bump(byGood, g.nc8, g);
    bump(byGroup, g.group, g);
  }
  const top = (
    m: Map<string, { v: number; kg: number }>,
    names: Map<string, string>,
    limit: number,
  ) =>
    [...m.entries()]
      .map(([code, t]) => ({
        code,
        name: labelOf(names, code),
        valueEur: t.v,
        share: total > 0 ? t.v / total : 0,
        massKg: t.kg,
      }))
      .sort((a, b) => b.valueEur - a.valueEur)
      .slice(0, limit);
  return {
    totalEur: total,
    goods: top(byGood, productNames, goodsLimit),
    groups: top(byGroup, groupNames, groupsLimit),
  };
}

// ---------------------------------------------------------------------------------------
// Printing

const eur = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const formatEur = (n: number) =>
  `${eur.format(Math.round(n)).replace(/[\u202F\u00A0]/g, ' ')}`;
export const formatShare = (s: number) => `${(s * 100).toFixed(1)} %`;

/** A plain-text table with left-aligned first column and right-aligned numbers. */
export function textTable(headers: string[], body: string[][], leftColumns = 1): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? '').length)));
  const row = (cells: string[]) =>
    cells
      .map((c, i) => (i < leftColumns ? c.padEnd(widths[i]!) : c.padStart(widths[i]!)))
      .join('  ');
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
