import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectDelimiter,
  eurostatUrl,
  findTunisia,
  formatResourceList,
  labelMap,
  labelOf,
  latestMonths,
  looksUtf8,
  NationalReader,
  parseCodeNames,
  parseNumber,
  chooseDataFile,
  pickDataFile,
  pickLabelFiles,
  splitLine,
  summarize,
  sumJsonStat,
  textTable,
  type Resource,
} from './customsTrade.js';

// Small fixtures written like the real files are described: semicolons, comma decimals,
// accents. The real files were not seen, so the layouts here are the documented ones.

const COUNTRIES = 'Code;Libellé\nTN;TUNISIE\nDZ;ALGÉRIE\nMA;MAROC\n';
const NC8 = 'NC8;Libellé NC8\n15099000;Huile d’olive vierge\n62034231;Pantalons en coton\n';
const A129 = 'A129;Libellé A129\nAZ;Produits agricoles\nCJ;Textiles\n';

const HEADER = 'Flux;Mois;Année;Code CPF6;Code A129;Code NC8;Code Pays;Valeur;Masse;USUP';
// Fourteen months of imports of olive oil and clothes, plus one export row a month.
function dataFile(months: [number, number][]): string {
  const rows = [HEADER];
  for (const [y, m] of months) {
    rows.push(`I;${m};${y};1;AZ;15099000;TN;1 000,50;10;0`);
    rows.push(`I;${m};${y};2;CJ;62034231;TN;500;5;0`);
    rows.push(`E;${m};${y};3;CJ;62034231;TN;200;2;0`);
    rows.push(`I;${m};${y};1;AZ;15099000;DZ;99999;1;0`);
  }
  return rows.join('\n');
}
const MONTHS: [number, number][] = [
  ...[11, 12].map((m) => [2023, m] as [number, number]),
  ...Array.from({ length: 12 }, (_, i) => [2024, i + 1] as [number, number]),
];

function read(text: string, code = 'TN'): NationalReader {
  const [header, ...rest] = text.split('\n');
  const reader = new NationalReader(header!, code);
  for (const line of rest) reader.add(line);
  return reader;
}

describe('text handling', () => {
  it('reads UTF-8, drops a BOM, and falls back to Latin-1', () => {
    expect(decodeText(Buffer.from('\uFEFFRégion', 'utf8'))).toBe('Région');
    expect(decodeText(Buffer.from('Région', 'latin1'))).toBe('Région');
    expect(looksUtf8(Buffer.from('Région', 'utf8'))).toBe(true);
    expect(looksUtf8(Buffer.from('Région', 'latin1'))).toBe(false);
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

describe('choosing the files', () => {
  const r = (title: string, format: string, url = `https://x.test/${title}`): Resource => ({
    title,
    format,
    url,
    size: null,
  });
  const EXPORT =
    'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/statistiques-nationales-du-commerce-exterieur/exports/csv';
  const files = [
    r('202002-national-2019-import.zip', 'zip'),
    r(
      '202002-stat-national-ce-import.zip',
      'zip',
      'https://x.test/statistiques-nationales-du-commerce-exterieur.zip',
    ),
    r('statistiques-nationales-du-commerce-exterieur.csv', 'csv', EXPORT),
    r('statistiques-nationales-du-commerce-exterieur.json', 'json'),
    r('LISEZ-MOI.txt', 'txt'),
    r('libelle-NC8-2023.csv', 'csv'),
    r('libelle-NC8-2024.csv', 'csv'),
    r('libelle-PAYS.csv', 'csv'),
    r('libelle-A129.csv', 'csv'),
  ];

  it('takes the country and group names, and the newest product names, in any order', () => {
    for (const list of [files, [...files].reverse()]) {
      const picked = pickLabelFiles(list);
      expect(picked.countries.title).toBe('libelle-PAYS.csv');
      expect(picked.groups?.title).toBe('libelle-A129.csv');
      expect(picked.products?.title).toBe('libelle-NC8-2024.csv');
    }
  });

  it('works without the optional name files, and stops when the country names are missing', () => {
    const picked = pickLabelFiles([files[7]!]);
    expect(picked.groups).toBeNull();
    expect(picked.products).toBeNull();
    expect(() => pickLabelFiles([files[2]!])).toThrow(/libelle-PAYS/);
  });

  it('ignores zips and takes the csv whose address ends in /exports/csv', () => {
    expect(pickDataFile(files).url).toBe(EXPORT);
  });

  it('uses exactly the --data-url address and never runs the picker', () => {
    // Two files that would stop the picker: the address given is still used, as it is.
    const messy = [files[2]!, r('same again', 'csv', `${EXPORT}?use_labels=false`)];
    const mine = 'https://example.test/my/data.csv?x=1';
    expect(chooseDataFile(messy, mine).url).toBe(mine);
    expect(chooseDataFile([], mine).url).toBe(mine);
    expect(chooseDataFile(files, null).url).toBe(EXPORT);
  });

  it('prefers the /exports/csv address over a plain csv with the same name', () => {
    const plain = r(
      'statistiques-nationales-du-commerce-exterieur.csv',
      'csv',
      'https://x.test/statistiques-nationales-du-commerce-exterieur.csv',
    );
    expect(pickDataFile([plain, files[2]!]).url).toBe(EXPORT);
  });

  it('prefers use_labels=true when several exports remain', () => {
    const labelled = r('avec libellés', 'csv', `${EXPORT}?use_labels=true`);
    const bare = r('sans libellés', 'csv', `${EXPORT}?use_labels=false`);
    expect(pickDataFile([bare, labelled]).url).toBe(`${EXPORT}?use_labels=true`);
    expect(pickDataFile([labelled, bare]).url).toBe(`${EXPORT}?use_labels=true`);
  });

  it('stops and lists the files when nothing, or more than one, is left', () => {
    expect(() => pickDataFile([files[0]!, files[7]!])).toThrow(
      /No file[\s\S]*202002-national-2019-import\.zip[\s\S]*--data-url/,
    );
    const two = [r('a', 'csv', `${EXPORT}?x=1`), r('b', 'csv', `${EXPORT}?x=2`)];
    expect(() => pickDataFile(two)).toThrow(/More than one file[\s\S]*--data-url/);
  });

  it('lists every file with its format and size', () => {
    const text = formatResourceList([{ ...files[0]!, size: 12_500_000 }, files[4]!]);
    expect(text).toMatch(/1\s+202002-national-2019-import\.zip\s+zip\s+12.5 MB/);
    expect(text).toMatch(/2\s+LISEZ-MOI\.txt\s+txt\s+size not stated/);
  });
});

describe('the national file, read line by line', () => {
  it('keeps only Tunisia and counts every row', () => {
    const reader = read(dataFile(MONTHS));
    expect(reader.rowsRead).toBe(14 * 4);
    expect(reader.rows).toHaveLength(14 * 3);
    expect(reader.skipped).toBe(0);
  });

  it('reads comma decimals and spaces in the values, and adds repeated lines', () => {
    const text = `${HEADER}\nI;3;2024;1;AZ;15099000;TN;1 000,50;10;0\nI;3;2024;1;AZ;15099000;TN;99,5;1;0`;
    const [good] = read(text).rows;
    expect(good).toMatchObject({ flow: 'import', month: 202403, valueEur: 1100, massKg: 11 });
  });

  it('takes a comma-separated file and a code with leading zeros', () => {
    const text =
      'Flux,Mois,Année,Code A129,Code NC8,Code Pays,Valeur,Masse\nImport,3,2024,AZ,15099000,0336,"1 000",5';
    expect(read(text, '336').rows).toEqual([
      { flow: 'import', month: 202403, group: 'AZ', nc8: '15099000', valueEur: 1000, massKg: 5 },
    ]);
  });

  it('counts a Tunisia row it cannot use instead of dropping it silently', () => {
    const text = `${HEADER}\nX;3;2024;1;AZ;15099000;TN;5;1;0\nI;3;2024;1;AZ;15099000;TN;abc;1;0`;
    expect(read(text).skipped).toBe(2);
  });

  it('stops and names the headers it found when a needed column is missing', () => {
    expect(() => new NationalReader('Flux;Autre;Valeur', 'TN')).toThrow(
      /no column for: mois, annee, a129, nc8, pays, masse.*Flux \| Autre \| Valeur/,
    );
  });
});

describe('the latest 12 months', () => {
  it('takes the last twelve present in the file', () => {
    const reader = read(dataFile(MONTHS));
    const { months, leftOut } = latestMonths(reader.monthRows);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe(202401);
    expect(months[11]).toBe(202412);
    expect(leftOut).toBeNull();
  });

  it('leaves out a newest month that is only half filled, and says so', () => {
    const counts = new Map([
      [202401, 100],
      [202402, 100],
      [202403, 100],
      [202404, 20],
    ]);
    expect(latestMonths(counts, 12)).toEqual({ months: [202401, 202402, 202403], leftOut: 202404 });
  });

  it('uses all of them when there are fewer than twelve', () => {
    expect(latestMonths(new Map([[202401, 5]]), 12)).toEqual({ months: [202401], leftOut: null });
  });
});

describe('grouping, shares and labels', () => {
  const reader = read(dataFile(MONTHS));
  const { months } = latestMonths(reader.monthRows);
  const products = labelMap(parseCodeNames(NC8));
  const groups = labelMap(parseCodeNames(A129));

  it('adds up by good over the months used only, with shares and kilograms', () => {
    const imports = summarize(reader.rows, months, 'import', products, groups);
    // 12 months used: 1 000,5 and 500 a month; the two months of 2023 are outside.
    expect(imports.totalEur).toBeCloseTo(12 * 1500.5, 6);
    expect(imports.goods.map((g) => g.code)).toEqual(['15099000', '62034231']);
    expect(imports.goods[0]).toMatchObject({ valueEur: 12 * 1000.5, massKg: 120 });
    expect(imports.goods[0]!.share).toBeCloseTo(1000.5 / 1500.5, 6);
    expect(imports.goods.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 6);
  });

  it('joins the French labels, and leaves the label empty when there is none', () => {
    const imports = summarize(reader.rows, months, 'import', products, groups);
    expect(imports.goods[0]!.name).toBe('Huile d’olive vierge');
    expect(imports.groups[0]).toMatchObject({ code: 'AZ', name: 'Produits agricoles' });
    const unlabelled = summarize(reader.rows, months, 'import', new Map(), new Map());
    expect(unlabelled.goods[0]!.name).toBe('');
  });

  it('keeps imports and exports apart and respects the limits', () => {
    const exports_ = summarize(reader.rows, months, 'export', products, groups, 1, 1);
    expect(exports_.totalEur).toBe(12 * 200);
    expect(exports_.goods).toHaveLength(1);
    expect(exports_.groups).toHaveLength(1);
  });

  it('finds a label whose code lost its leading zeros', () => {
    const map = labelMap([{ code: '01012100', name: 'Chevaux' }]);
    expect(labelOf(map, '1012100')).toBe('Chevaux');
    expect(labelOf(map, '01012100')).toBe('Chevaux');
    expect(labelOf(map, '99999999')).toBe('');
  });

  it('reads a label file with an English column beside the French one', () => {
    const entries = parseCodeNames(
      'Code;Libellé anglais;Libellé\n15099000;Olive oil;Huile d’olive\n',
    );
    expect(entries.find((e) => e.code === '15099000')?.name).toBe('Huile d’olive');
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
