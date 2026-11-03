import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectDelimiter,
  eurostatUrl,
  findTunisia,
  latestQuarters,
  parseCodeNames,
  parseDepartmentRegion,
  parseNumber,
  chooseFiles,
  classifyPreview,
  formatResourceList,
  readTradeRows,
  readZip,
  splitLine,
  sumJsonStat,
  textTable,
  topProducts,
  totalsByRegion,
  type Resource,
} from './customsTrade.js';

// Small fixtures written like the real files are described: semicolons, comma decimals,
// accents. The real files were not seen, so the layouts here are the documented ones.

const COUNTRIES = 'Code;Libellé\nTN;TUNISIE\nDZ;ALGÉRIE\nMA;MAROC\n';
const DEPT_REGION =
  'Code département;Département;Code région;Région\n13;Bouches-du-Rhône;93;Provence-Alpes-Côte d’Azur\n69;Rhône;84;Auvergne-Rhône-Alpes\n75;Paris;11;Île-de-France\n';

const HEADER =
  'Flux;Trimestre;Année;Code département;Code région;Code A129;Code CPF4;Code Pays;Valeur;Masse';
const DATA = [
  HEADER,
  'I;1;2024;13;93;AZ;0111;TN;1 000,50;10',
  'E;1;2024;13;93;CJ;2011;TN;2 000;20',
  'I;2;2024;69;84;AZ;0111;TN;500;5',
  'E;2;2024;75;11;CK;2012;TN;3 500,25;30',
  'E;3;2024;75;11;CK;2012;TN;100;1',
  'I;4;2024;75;11;AZ;0111;TN;200;2',
  'E;1;2025;75;11;CK;2012;TN;50;1',
  'E;1;2025;13;93;CK;2012;DZ;99999;1',
  'I;1;2023;13;93;AZ;0111;TN;7777;1',
].join('\n');

const regions = parseDepartmentRegion(DEPT_REGION);

describe('text handling', () => {
  it('reads UTF-8, drops a BOM, and falls back to Latin-1', () => {
    expect(decodeText(Buffer.from('\uFEFFRégion', 'utf8'))).toBe('Région');
    expect(decodeText(Buffer.from('Région', 'latin1'))).toBe('Région');
  });

  it('finds the separator and splits quoted fields', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a,b')).toBe(',');
    expect(detectDelimiter('plain')).toBeNull();
    expect(splitLine('a;"b;c";"d ""q"""', ';')).toEqual(['a', 'b;c', 'd "q"']);
  });

  it('reads French and plain numbers', () => {
    expect(parseNumber('1 234 567,89')).toBe(1234567.89);
    expect(parseNumber('1\u00A0234,5')).toBe(1234.5);
    expect(parseNumber('12.345,6')).toBe(12345.6);
    expect(parseNumber('1234567.5')).toBe(1234567.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('Tunisia in the country file', () => {
  it('finds its code by name, not by assuming TN', () => {
    expect(findTunisia(parseCodeNames('Code;Libellé\n336;TUNISIE\n208;ALGERIE\n')).code).toBe(
      '336',
    );
    expect(findTunisia(parseCodeNames(COUNTRIES)).code).toBe('TN');
  });

  it('reads a file that is plain "CODE  NAME" lines', () => {
    const entries = parseCodeNames('TN   TUNISIE\nDZ   ALGERIE\n');
    expect(findTunisia(entries).code).toBe('TN');
  });

  it('stops and lists the candidates when more than one code could be Tunisia', () => {
    const found = findTunisia(
      parseCodeNames('Code;Libellé\nTN;TUNISIE\nTU;TUNISIE (ZONE FRANCHE)\n'),
    );
    expect(found.code).toBeNull();
    expect(found.candidates.map((c) => c.code)).toEqual(['TN', 'TU']);
  });

  it('says nothing was found when there is no Tunisia', () => {
    const found = findTunisia(parseCodeNames('Code;Libellé\nDZ;ALGERIE\n'));
    expect(found.code).toBeNull();
    expect(found.candidates).toEqual([]);
  });
});

describe('region names', () => {
  it('maps departments to regions and names regions, accents kept', () => {
    expect(regions.regionOfDepartment.get('13')).toBe('93');
    expect(regions.regionName.get('84')).toBe('Auvergne-Rhône-Alpes');
  });
});

describe('reading the trade rows', () => {
  const read = readTradeRows(DATA, 'TN', regions);

  it('keeps only Tunisia and counts every row it read', () => {
    expect(read.rowsRead).toBe(9);
    expect(read.rows).toHaveLength(8);
    expect(read.quarters).toEqual([20231, 20241, 20242, 20243, 20244, 20251]);
  });

  it('reads comma decimals and spaces in the values', () => {
    expect(read.rows[0]).toMatchObject({ flow: 'import', valueEur: 1000.5, regionCode: '93' });
    expect(read.rows[3]).toMatchObject({ flow: 'export', valueEur: 3500.25 });
  });

  it('takes a comma-separated Latin-1 file too, and matches a code with leading zeros', () => {
    const text = decodeText(
      Buffer.from(
        'Flux,Trimestre,Année,Code département,Code région,Code A129,Code Pays,Valeur\nImport,3,2024,13,93,AZ,0336,"1 000"\n',
        'latin1',
      ),
    );
    const r = readTradeRows(text, '336', regions);
    expect(r.rows).toEqual([
      { flow: 'import', quarter: 20243, regionCode: '93', productCode: 'AZ', valueEur: 1000 },
    ]);
  });

  it('turns a department into its region when the region cell is empty', () => {
    const text = `${HEADER}\nI;1;2024;69;;AZ;0111;TN;10;1\n`;
    expect(readTradeRows(text, 'TN', regions).rows[0]!.regionCode).toBe('84');
  });

  it('names the headers it found when a needed column is missing', () => {
    expect(() => readTradeRows('Flux;Autre\nI;1\n', 'TN', regions)).toThrow(
      /no column for: trimestre, country, value.*Flux \| Autre/,
    );
  });
});

describe('adding up', () => {
  const read = readTradeRows(DATA, 'TN', regions);

  it('picks the latest four quarters present', () => {
    expect(latestQuarters(read.quarters)).toEqual([20242, 20243, 20244, 20251]);
    expect(latestQuarters([20241, 20241, 20242], 4)).toEqual([20241, 20242]);
  });

  it('totals by region over those quarters, sorted, with shares of the national total', () => {
    const quarters = latestQuarters(read.quarters);
    const totals = totalsByRegion(read.rows, quarters, regions.regionName);
    // Paris: 3500.25 + 100 + 200 + 50 = 3850.25; Rhône: 500. Paris-region quarters 2024 T1 and
    // the 2023 row are outside the window, so the Bouches-du-Rhône rows do not count.
    expect(totals.map((t) => t.regionName)).toEqual(['Île-de-France', 'Auvergne-Rhône-Alpes']);
    expect(totals[0]).toMatchObject({ importEur: 200, exportEur: 3650.25, totalEur: 3850.25 });
    expect(totals[0]!.share).toBeCloseTo(3850.25 / 4350.25, 6);
    expect(totals.reduce((a, t) => a + t.share, 0)).toBeCloseTo(1, 6);
  });

  it('ranks product groups per flow, using names when there are any', () => {
    const quarters = latestQuarters(read.quarters);
    expect(topProducts(read.rows, quarters, 'export', new Map([['CK', 'Chimie']]), 10)).toEqual([
      { code: 'CK', name: 'Chimie', valueEur: 3650.25 },
    ]);
    expect(topProducts(read.rows, quarters, 'import', new Map(), 1)).toEqual([
      { code: 'AZ', name: '', valueEur: 700 },
    ]);
  });
});

describe('choosing the dataset files by what is inside', () => {
  const r = (title: string, format = 'csv', size: number | null = null): Resource => ({
    title,
    format,
    url: `https://x.test/${encodeURIComponent(title)}`,
    size,
  });

  it('lists every file with its format and size', () => {
    const text = formatResourceList([r('Données', 'csv', 12_500_000), r('Notice', 'pdf')]);
    expect(text).toMatch(/1\s+Données\s+csv\s+12.5 MB/);
    expect(text).toMatch(/2\s+Notice\s+pdf\s+size not stated/);
  });

  it('recognises the regional data by its columns, whatever the title', () => {
    expect(classifyPreview(DATA).kind).toBe('data');
    expect(classifyPreview(DATA)).toMatchObject({ hasDepartment: true, hasQuarter: true });
    // A national file has no region or department code.
    expect(
      classifyPreview('Flux;Trimestre;Année;Code CPF4;Code Pays;Valeur;Masse\nI;1;2024;01;TN;5;1')
        .kind,
    ).toBe('unknown');
  });

  it('recognises a region-names file and a country file', () => {
    expect(classifyPreview(DEPT_REGION).kind).toBe('regions');
    expect(classifyPreview(COUNTRIES).kind).toBe('countries');
    expect(classifyPreview('Code;Libellé\nAA;Autre\n').kind).toBe('unknown');
  });

  it('picks the data file, the region names and the countries from their content', () => {
    const looked = [
      { resource: r('Titre sans rapport'), info: classifyPreview(COUNTRIES) },
      { resource: r('Données A'), info: classifyPreview(DATA) },
      { resource: r('Noms'), info: classifyPreview(DEPT_REGION) },
      { resource: r('Nationales'), info: classifyPreview('Flux;Valeur;Code Pays\nI;1;TN') },
    ];
    const choice = chooseFiles(looked);
    expect(choice.data.title).toBe('Données A');
    expect(choice.regions?.title).toBe('Noms');
    expect(choice.countries?.title).toBe('Titre sans rapport');
  });

  it('does not stop when no file names the regions: it says there is none', () => {
    const choice = chooseFiles([{ resource: r('Données'), info: classifyPreview(DATA) }]);
    expect(choice.regions).toBeNull();
  });

  it('stops and shows what each file holds when no file is regional data', () => {
    const looked = [
      { resource: r('Nationales'), info: classifyPreview('Flux;Valeur;Code Pays\nI;1;TN') },
    ];
    expect(() => chooseFiles(looked)).toThrow(
      /Nationales[\s\S]*Flux \| Valeur \| Code Pays[\s\S]*--data-url/,
    );
  });

  it('stops when two files look equally like the data', () => {
    const looked = [
      { resource: r('A'), info: classifyPreview(DATA) },
      { resource: r('B'), info: classifyPreview(DATA) },
    ];
    expect(() => chooseFiles(looked)).toThrow(/More than one file[\s\S]*A[\s\S]*B/);
  });
});

describe('without a region-names file', () => {
  it('prints the region code as it is', () => {
    const read = readTradeRows(DATA, 'TN', {
      regionOfDepartment: new Map(),
      regionName: new Map(),
    });
    const totals = totalsByRegion(read.rows, latestQuarters(read.quarters), new Map());
    expect(totals.map((t) => t.regionName)).toEqual(['11', '84']);
  });
});

describe('zip files', () => {
  /** A one-file zip, built by hand the way a zip tool would. */
  function zip(name: string, content: string, deflate: boolean): Buffer {
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    const centralAt = local.length + nameBuf.length + data.length;
    eocd.writeUInt32LE(centralAt, 16);
    eocd.writeUInt32LE(central.length + nameBuf.length, 12);
    return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
  }

  it('reads stored and deflated entries', () => {
    for (const deflate of [false, true]) {
      const [entry] = readZip(zip('data.csv', 'a;b\n1;2\n', deflate));
      expect(entry!.name).toBe('data.csv');
      expect(entry!.data.toString()).toBe('a;b\n1;2\n');
    }
  });

  it('refuses a file that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just text'.repeat(3)))).toThrow(
      /not a zip/,
    );
  });
});

describe('Eurostat helpers', () => {
  it('adds up the numbers of a JSON-stat answer, whichever shape they come in', () => {
    expect(sumJsonStat({ value: { '0': 5, '1': 7 } })).toBe(12);
    expect(sumJsonStat({ value: [1, null, 2] })).toBe(3);
    expect(sumJsonStat({ value: {} })).toBeNull();
    expect(sumJsonStat(null)).toBeNull();
  });

  it('asks for one reporter, flow and year', () => {
    const url = new URL(eurostatUrl('FR', 2, 2024));
    expect(url.pathname).toMatch(/DS-045409$/);
    expect(url.searchParams.get('reporter')).toBe('FR');
    expect(url.searchParams.get('partner')).toBe('TN');
    expect(url.searchParams.get('flow')).toBe('2');
    expect(url.searchParams.get('time')).toBe('2024');
  });
});

describe('plain-text table', () => {
  it('lines up columns', () => {
    expect(
      textTable(
        ['A', 'Number'],
        [
          ['xx', '1'],
          ['y', '1 000'],
        ],
      ),
    ).toBe(['A   Number', '--  ------', 'xx       1', 'y    1 000'].join('\n'));
  });
});
