import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chooseFiles,
  classifyPreview,
  csvCell,
  decodeText,
  eurostatUrl,
  findTunisia,
  formatResourceList,
  formatEur,
  formatShare,
  latestQuarters,
  parseCodeNames,
  parseDepartmentRegion,
  quarterLabel,
  readTradeRows,
  readZip,
  sumJsonStat,
  textTable,
  topProducts,
  totalsByRegion,
  type EurostatTotals,
  type Looked,
  type RegionNames,
  type Resource,
} from '../lib/customsTrade.js';

// Which French regions trade most with Tunisia, from the customs open data on data.gouv.fr.
//
//   npm run trade:tunisia                     download (once), print the tables, write a CSV
//   npm run trade:tunisia -- --refresh        download again even if a copy is kept
//   npm run trade:tunisia -- --eurostat       also print France, Germany and Italy side by side
//   npm run trade:tunisia -- --data-url URL   use this file as the regional data (if the
//                                             script cannot tell which one it is)
//
// Free and read-only: it touches no database, no app data and no paid service. It makes one
// download per file, and keeps them in a temp folder so a re-run does not download again.

const DATASET_ID = '5369a0b4a3a729239d206418';
const DATASET_URL =
  process.env.TRADE_DATASET_URL ?? `https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`;
const USER_AGENT =
  'lead-gen-crm-trade-script/1.0 (reads open customs statistics for a Tunisian transport lead tool)';
const TIMEOUT_MS = 120_000;

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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** One download per file; a kept copy is reused unless --refresh. */
async function download(url: string, name: string): Promise<Buffer> {
  const path = join(cacheDir, name);
  if (!refresh && (await exists(path))) {
    console.log(`Using the copy already downloaded: ${name}`);
    return readFile(path);
  }
  console.log(`Downloading ${url}`);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    fail(`Could not reach ${url}. Check your internet connection and try again. (${why})`);
  }
  if (!res.ok) fail(`${url} answered with HTTP ${res.status}. Try again later.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, bytes);
  return bytes;
}

const safeName = (r: Resource) =>
  r.url
    .split('/')
    .pop()
    ?.replace(/[^\w.-]/g, '_') || 'file';

function textOf(bytes: Buffer): string {
  if (bytes.subarray(0, 2).toString() !== 'PK') return decodeText(bytes);
  const files = readZip(bytes).filter((f) => /\.(csv|txt)$/i.test(f.name));
  if (files.length === 0) fail('The downloaded zip has no .csv or .txt file in it.');
  files.sort((a, b) => b.data.length - a.data.length);
  console.log(`Reading ${files[0]!.name} from the zip.`);
  return decodeText(files[0]!.data);
}

const PREVIEW_BYTES = 64 * 1024;

/**
 * The start of a file, enough to read its header: one small request for a text file, the whole
 * (kept) download for a zip, since a zip's index is at its end.
 */
async function preview(resource: Resource): Promise<string | null> {
  const isZip = /zip/i.test(resource.format) || /\.zip(\?|$)/i.test(resource.url);
  if (isZip) {
    const files = readZip(await download(resource.url, `data-${safeName(resource)}`)).filter((f) =>
      /\.(csv|txt)$/i.test(f.name),
    );
    files.sort((a, b) => b.data.length - a.data.length);
    return files[0] ? decodeText(files[0].data.subarray(0, PREVIEW_BYTES)) : null;
  }
  try {
    const res = await fetch(resource.url, {
      headers: { 'user-agent': USER_AGENT, range: `bytes=0-${PREVIEW_BYTES - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return null;
    // A server that ignores the range sends the whole file: read the first part and stop.
    const chunks: Buffer[] = [];
    let got = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
      got += chunk.length;
      if (got >= PREVIEW_BYTES) break;
    }
    const bytes = Buffer.concat(chunks).subarray(0, PREVIEW_BYTES);
    // Cut at the last full line so a half line is not read as data.
    const cut = bytes.lastIndexOf(10);
    return decodeText(got >= PREVIEW_BYTES && cut > 0 ? bytes.subarray(0, cut) : bytes);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const datasetBytes = await download(DATASET_URL, 'dataset.json');
  const dataset = JSON.parse(datasetBytes.toString()) as {
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
  console.log(`\nDataset: ${dataset.title ?? DATASET_ID}`);
  console.log(`Licence (as the dataset states it): ${dataset.license ?? 'not stated'}`);
  console.log(
    `\nFiles in the dataset (${resources.length}):\n\n${formatResourceList(resources)}\n`,
  );

  // Which file is which is judged by what is inside, so the title does not matter. Only
  // table-like files are looked at; pdf and json are skipped.
  const worth = resources.filter(
    (r) => r.url !== '' && /csv|txt|zip|tsv|text/i.test(r.format || r.url),
  );
  const looked: Looked[] = [];
  for (const resource of worth) {
    const text = await preview(resource);
    if (text !== null) looked.push({ resource, info: classifyPreview(text) });
  }
  let choice;
  try {
    choice = chooseFiles(looked);
  } catch (err) {
    if (dataUrlOverride === null) fail(err instanceof Error ? err.message : String(err));
    choice = null;
  }
  const dataResource: Resource =
    dataUrlOverride !== null
      ? { title: 'chosen with --data-url', format: '', url: dataUrlOverride, size: null }
      : choice!.data;
  console.log(`Regional data file used: ${dataResource.title} (${dataResource.url})`);
  const countriesFile =
    choice?.countries ?? looked.find((l) => l.info.kind === 'countries')?.resource ?? null;
  const regionsFile =
    choice?.regions ?? looked.find((l) => l.info.kind === 'regions')?.resource ?? null;
  console.log(
    `Country names file: ${countriesFile?.title ?? 'none found'}. Region names file: ${regionsFile?.title ?? 'none found, region codes will be printed as they are'}.\n`,
  );
  if (!countriesFile) {
    fail(
      "No file in the dataset lists country names, so Tunisia's code cannot be looked up and none is guessed.",
    );
  }

  const countries = parseCodeNames(
    textOf(await download(countriesFile.url, `countries-${safeName(countriesFile)}`)),
  );
  const tunisia = findTunisia(countries);
  if (tunisia.code === null) {
    const list = tunisia.candidates.map((c) => `  ${c.code}  ${c.name}`).join('\n');
    fail(
      tunisia.candidates.length === 0
        ? `Tunisia was not found in the country file (${countries.length} countries read).`
        : `More than one code could be Tunisia, so nothing was guessed:\n${list}`,
    );
  }
  console.log(`Tunisia's code in the country file: ${tunisia.code}`);

  const regions: RegionNames = regionsFile
    ? parseDepartmentRegion(
        textOf(await download(regionsFile.url, `regions-${safeName(regionsFile)}`)),
      )
    : { regionOfDepartment: new Map(), regionName: new Map() };
  // No product-group names are looked up: their file was not seen, so codes are printed.
  const productNames = new Map<string, string>();

  const dataText = textOf(await download(dataResource.url, `data-${safeName(dataResource)}`));
  let read;
  try {
    read = readTradeRows(dataText, tunisia.code, regions);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const quarters = latestQuarters(read.quarters, 4);
  if (quarters.length === 0) fail('The data file has no readable quarters.');
  const byRegion = totalsByRegion(read.rows, quarters, regions.regionName);
  const imports = topProducts(read.rows, quarters, 'import', productNames);
  const exports_ = topProducts(read.rows, quarters, 'export', productNames);

  const usedLabel = quarters.map(quarterLabel).join(', ');
  console.log(`\nTrade with Tunisia by French region, quarters used: ${usedLabel}\n`);
  console.log(
    textTable(
      ['Region', 'Imports (EUR)', 'Exports (EUR)', 'Total (EUR)', 'Share'],
      byRegion.map((r) => [
        r.regionName,
        formatEur(r.importEur),
        formatEur(r.exportEur),
        formatEur(r.totalEur),
        formatShare(r.share),
      ]),
    ),
  );
  const product = (rows: typeof imports) =>
    textTable(
      ['Product group (A129)', 'Value (EUR)'],
      rows.map((p) => [p.name ? `${p.code} ${p.name}` : p.code, formatEur(p.valueEur)]),
    );
  console.log(
    `\nTop 10 product groups, imports from Tunisia (all of France)\n\n${product(imports)}`,
  );
  console.log(
    `\nTop 10 product groups, exports to Tunisia (all of France)\n\n${product(exports_)}`,
  );

  console.log(`
Rows read: ${read.rowsRead} (of which ${read.rows.length} for Tunisia). Quarters in the file: ${read.quarters.map(quarterLabel).join(', ')}.
Quarters used: ${usedLabel}.
Please note:
  - The region is where the goods physically leave France (exports) or arrive (imports),
    not where the company has its head office.
  - Some flows are hidden for confidentiality, so totals can be too low.
  - Values are euros of goods, not a number of companies.`);

  await mkdir(outDir, { recursive: true });
  const csvPath = join(outDir, `trade-tunisia-${quarters[quarters.length - 1]}.csv`);
  const csv = [
    ['Region code', 'Region', 'Imports EUR', 'Exports EUR', 'Total EUR', 'Share'],
    ...byRegion.map((r) => [
      r.regionCode,
      r.regionName,
      Math.round(r.importEur),
      Math.round(r.exportEur),
      Math.round(r.totalEur),
      r.share.toFixed(4),
    ]),
    [],
    ['Flow', 'Product code', 'Product', 'Value EUR'],
    ...imports.map((p) => ['import', p.code, p.name, Math.round(p.valueEur)]),
    ...exports_.map((p) => ['export', p.code, p.name, Math.round(p.valueEur)]),
    [],
    ['Quarters used', usedLabel],
    ['Licence', dataset.license ?? 'not stated'],
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
