import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  csvCell,
  decodeText,
  eurostatUrl,
  findTunisia,
  formatEur,
  formatResourceList,
  formatShare,
  labelMap,
  latestMonths,
  looksUtf8,
  monthLabel,
  NationalReader,
  parseCodeNames,
  chooseDataFile,
  pickLabelFiles,
  sumJsonStat,
  summarize,
  textTable,
  type EurostatTotals,
  type Resource,
  type Summary,
} from '../lib/customsTrade.js';

// Which goods France buys from Tunisia, and sells to it, from the customs open data on
// data.gouv.fr (the national monthly file, product by product).
//
//   npm run trade:tunisia                     download (once), print the tables, write a CSV
//   npm run trade:tunisia -- --refresh        download again even if a copy is kept
//   npm run trade:tunisia -- --eurostat       also print France, Germany and Italy side by side
//   npm run trade:tunisia -- --data-url URL   use this file as the national monthly data
//
// Free and read-only: it touches no database, no app data and no paid service. The big file
// is read one line at a time and never held in memory. The dataset has no regional file, so
// there is nothing here by region.

const DATASET_ID = '5369a0b4a3a729239d206418';
const DATASET_URL =
  process.env.TRADE_DATASET_URL ?? `https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`;
const USER_AGENT =
  'lead-gen-crm-trade-script/1.0 (reads open customs statistics for a Tunisian transport lead tool)';
const SMALL_TIMEOUT_MS = 60_000;
const BIG_TIMEOUT_MS = 15 * 60_000;
const TRIES = 3;
const WAIT_MS = [5_000, 20_000];

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const eurostat = args.includes('--eurostat');
const dataUrlAt = args.indexOf('--data-url');
const dataUrlOverride = dataUrlAt === -1 ? null : (args[dataUrlAt + 1] ?? null);

const cacheDir = join(tmpdir(), 'lead-gen-crm-trade');
const outDir = fileURLToPath(new URL('../../trade-tunisia-output/', import.meta.url));

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * One download per file, written straight to disk and kept for next time (--refresh to download
 * again). A slow or failing server (5xx, timeout, no answer) is tried again up to 3 times, with
 * a wait between tries; anything else, such as "not found", stops at once.
 */
async function download(url: string, name: string, timeoutMs = SMALL_TIMEOUT_MS): Promise<string> {
  const path = join(cacheDir, name);
  if (!refresh && (await exists(path))) {
    console.log(`Using the copy already downloaded: ${name}`);
    return path;
  }
  await mkdir(cacheDir, { recursive: true });
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    console.log(`Downloading ${url}${attempt > 1 ? ` (try ${attempt} of ${TRIES})` : ''}`);
    let problem: string;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok && res.body) {
        const part = `${path}.part`;
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
        await rename(part, path);
        return path;
      }
      if (res.status < 500) fail(`${url} answered with HTTP ${res.status}. Check the address.`);
      problem = `the server answered HTTP ${res.status}, which usually means it is busy`;
    } catch (err) {
      problem = `no complete answer (${err instanceof Error ? err.message : String(err)})`;
    }
    if (attempt === TRIES) {
      fail(`Giving up on ${url}: ${problem}. Check your internet connection or try again later.`);
    }
    const wait = WAIT_MS[attempt - 1] ?? 20_000;
    console.log(
      `  The download did not work: ${problem}. Waiting ${wait / 1000} s, then trying again.`,
    );
    await sleep(wait);
  }
  fail(`Could not download ${url}.`);
}

/** A small file (names list), read whole. */
async function readText(path: string): Promise<string> {
  return decodeText(await readFile(path));
}

/** The lines of a big file, one at a time, read as UTF-8 or Latin-1 (judged from its start). */
async function* readLines(path: string): AsyncGenerator<string> {
  const handle = await open(path, 'r');
  const head = Buffer.alloc(64 * 1024);
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  await handle.close();
  let sample = head.subarray(0, bytesRead);
  const cut = sample.lastIndexOf(10);
  if (bytesRead === head.length && cut > 0) sample = sample.subarray(0, cut);
  const decoder = new TextDecoder(looksUtf8(sample) ? 'utf-8' : 'latin1');
  let rest = '';
  let first = true;
  for await (const chunk of createReadStream(path)) {
    rest += decoder.decode(chunk as Buffer, { stream: true });
    if (first) {
      rest = rest.replace(/^\uFEFF/, '');
      first = false;
    }
    let at: number;
    while ((at = rest.indexOf('\n')) !== -1) {
      const line = rest.slice(0, at).replace(/\r$/, '');
      rest = rest.slice(at + 1);
      if (line.trim() !== '') yield line;
    }
  }
  if (rest.trim() !== '') yield rest.replace(/\r$/, '');
}

/** A cache file name from the address: its last part, plus a short hash so two addresses never share a copy. */
const safeName = (r: Resource) =>
  `${(r.url.split('?')[0]!.split('/').pop() ?? 'file').replace(/[^\w.-]/g, '_')}-${createHash('sha1').update(r.url).digest('hex').slice(0, 8)}`;

async function names(file: Resource | null, what: string): Promise<Map<string, string>> {
  if (!file) {
    console.log(`No ${what} file in the dataset: codes will be printed without names.`);
    return new Map();
  }
  const path = await download(file.url, `${what}-${safeName(file)}`);
  return labelMap(parseCodeNames(await readText(path)));
}

async function main(): Promise<void> {
  const datasetPath = await download(DATASET_URL, 'dataset.json');
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as {
    title?: string;
    license?: string;
    resources?: { title?: string; format?: string; url?: string; filesize?: number | null }[];
  };
  const resources: Resource[] = (dataset.resources ?? []).map((r) => ({
    title: r.title ?? '',
    format: r.format ?? '',
    url: r.url ?? '',
    size: typeof r.filesize === 'number' ? r.filesize : null,
  }));
  const licence = dataset.license ?? 'not stated';
  console.log(`\nDataset: ${dataset.title ?? DATASET_ID}`);
  console.log(`Licence (as the dataset states it): ${licence}`);
  console.log(
    `\nFiles in the dataset (${resources.length}):\n\n${formatResourceList(resources)}\n`,
  );

  let files;
  try {
    files = pickLabelFiles(resources);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  // With --data-url that exact address is the data file and the picker is skipped.
  let dataFile: Resource;
  try {
    dataFile = chooseDataFile(resources, dataUrlOverride);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`National monthly file: ${dataFile.title} (${dataFile.url})`);
  console.log(`Country names: ${files.countries.title}`);
  console.log(`Product group names (A129): ${files.groups?.title ?? 'none'}`);
  console.log(`Product names (NC8): ${files.products?.title ?? 'none'}\n`);

  const countryEntries = parseCodeNames(
    await readText(await download(files.countries.url, `countries-${safeName(files.countries)}`)),
  );
  const tunisia = findTunisia(countryEntries);
  if (tunisia.code === null) {
    const list = tunisia.candidates.map((c) => `  ${c.code}  ${c.name}`).join('\n');
    fail(
      tunisia.candidates.length === 0
        ? `Tunisia was not found in the country file (${countryEntries.length} countries read).`
        : `More than one code could be Tunisia, so nothing was guessed:\n${list}`,
    );
  }
  console.log(`Tunisia's code in the country file: ${tunisia.code}`);
  const groupNames = await names(files.groups, 'groups');
  const productNames = await names(files.products, 'products');

  const dataPath = await download(dataFile.url, `data-${safeName(dataFile)}`, BIG_TIMEOUT_MS);
  console.log('\nReading the national file line by line (this can take a minute)...');
  let reader: NationalReader | null = null;
  for await (const line of readLines(dataPath)) {
    if (reader === null) {
      try {
        reader = new NationalReader(line, tunisia.code);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
      continue;
    }
    reader.add(line);
    if (reader.rowsRead % 2_000_000 === 0) console.log(`  ${reader.rowsRead} rows read...`);
  }
  if (reader === null) fail('The data file is empty.');
  const { months, leftOut } = latestMonths(reader.monthRows, 12);
  if (months.length === 0) fail('The data file has no readable months.');

  const rows = reader.rows;
  const imports = summarize(rows, months, 'import', productNames, groupNames);
  const exports_ = summarize(rows, months, 'export', productNames, groupNames);
  const usedLabel = `${monthLabel(months[0]!)} to ${monthLabel(months[months.length - 1]!)} (${months.length} months)`;

  const goodsTable = (s: Summary) =>
    textTable(
      ['NC8', 'Product', 'Value (EUR)', 'Share', 'Kg'],
      s.goods.map((g) => [
        g.code,
        g.name || '(no label)',
        formatEur(g.valueEur),
        formatShare(g.share),
        formatEur(g.massKg),
      ]),
      2,
    );
  const groupsTable = (s: Summary) =>
    textTable(
      ['A129', 'Product group', 'Value (EUR)', 'Share', 'Kg'],
      s.groups.map((g) => [
        g.code,
        g.name || '(no label)',
        formatEur(g.valueEur),
        formatShare(g.share),
        formatEur(g.massKg),
      ]),
      2,
    );
  const section = (title: string, table: string) => `\n${title}\n\n${table}`;
  console.log(`\nGoods traded between France and Tunisia, months used: ${usedLabel}`);
  console.log(`Total imports from Tunisia: ${formatEur(imports.totalEur)} EUR`);
  console.log(`Total exports to Tunisia: ${formatEur(exports_.totalEur)} EUR`);
  console.log(section('Top 20 goods France buys from Tunisia (NC8)', goodsTable(imports)));
  console.log(
    section('Top 10 product groups France buys from Tunisia (A129)', groupsTable(imports)),
  );
  console.log(section('Top 20 goods France sells to Tunisia (NC8)', goodsTable(exports_)));
  console.log(
    section('Top 10 product groups France sells to Tunisia (A129)', groupsTable(exports_)),
  );

  console.log(`
Rows read: ${reader.rowsRead}. Rows for Tunisia that could not be used: ${reader.skipped}.
Months used: ${months.map(monthLabel).join(', ')}.${leftOut !== null ? `\nLeft out because it looked only partly filled: ${monthLabel(leftOut)}.` : ''}
Please note:
  - Regions are NOT available: this file is national, with no region or department.
  - Some flows are hidden for confidentiality, so totals can be too low.
  - Values are euros of goods traded, not a number of companies; they say nothing about who trades.
  - Shares are of the total imports (or exports) with Tunisia over the months used.`);

  await mkdir(outDir, { recursive: true });
  const csvPath = join(outDir, `trade-tunisia-${months[months.length - 1]}.csv`);
  const csvRows = (label: string, s: Summary) => [
    ...s.goods.map((g) => [
      label,
      'NC8',
      g.code,
      g.name,
      Math.round(g.valueEur),
      g.share.toFixed(4),
      Math.round(g.massKg),
    ]),
    ...s.groups.map((g) => [
      label,
      'A129',
      g.code,
      g.name,
      Math.round(g.valueEur),
      g.share.toFixed(4),
      Math.round(g.massKg),
    ]),
  ];
  const csv = [
    ['Direction', 'Level', 'Code', 'Label', 'Value EUR', 'Share', 'Kg'],
    ...csvRows('import from Tunisia', imports),
    ...csvRows('export to Tunisia', exports_),
    [],
    ['Months used', usedLabel],
    ['Regions', 'not available in this file'],
    ['Licence', licence],
  ]
    .map((r) => r.map(csvCell).join(';'))
    .join('\r\n');
  await writeFile(csvPath, `\uFEFF${csv}\r\n`);
  console.log(`\nSame tables written to: ${csvPath}`);

  if (eurostat) await printEurostat();
}

async function eurostatValue(reporter: string, flow: 1 | 2, year: number): Promise<number | null> {
  const res = await fetch(eurostatUrl(reporter, flow, year), {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(SMALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return sumJsonStat(await res.json());
}

async function printEurostat(): Promise<void> {
  console.log('\nEurostat: goods trade with Tunisia (EUR), latest full year available');
  const out: EurostatTotals[] = [];
  const problems: string[] = [];
  for (const reporter of ['FR', 'DE', 'IT']) {
    let found: EurostatTotals | null = null;
    for (const year of [new Date().getFullYear() - 1, new Date().getFullYear() - 2]) {
      try {
        const [i, e] = [
          await eurostatValue(reporter, 1, year),
          await eurostatValue(reporter, 2, year),
        ];
        if (i !== null || e !== null) {
          found = { reporter, year, importEur: i, exportEur: e };
          break;
        }
      } catch (err) {
        problems.push(`${reporter} ${year}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (found) out.push(found);
  }
  if (out.length === 0) {
    console.log(
      'No numbers came back. The request or the dataset id (DS-045409) may not match what Eurostat serves.',
    );
  } else {
    const n = (v: number | null) => (v === null ? 'n/a' : formatEur(v));
    console.log(
      textTable(
        ['Country', 'Year', 'Imports from Tunisia', 'Exports to Tunisia'],
        out.map((t) => [t.reporter, String(t.year), n(t.importEur), n(t.exportEur)]),
      ),
    );
  }
  if (problems.length > 0) console.log(`\nProblems met:\n  ${problems.join('\n  ')}`);
}

await main();
