import { EXPORT_PDF_MAX_ROWS, type ExportRow } from '@lead-gen-crm/shared';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { visualOrder } from './bidi.js';
import { EXPORT_COLUMNS } from './columns.js';
import { neutralizeFormula, toCsv } from './csv.js';
import { toPdf } from './pdf.js';
import { toXlsx } from './xlsx.js';

const row = (o: Partial<ExportRow> = {}): ExportRow => ({
  company: 'Huilerie Baccar',
  person: 'Amel Ben Salah',
  role: 'Directrice logistique',
  sector: 'Olive oil',
  city: 'Sfax',
  phone: '+216 98 123 456',
  whatsapp: true,
  email: 'amel@baccar.tn',
  website: 'https://baccar.tn',
  score: 72,
  stage: 'Found',
  foundAt: '2026-10-18T10:00:00.000Z',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=34.7%2C10.7',
  ...o,
});

describe('CSV', () => {
  it('starts with a byte order mark and a header, and uses the chosen separator', () => {
    const comma = toCsv([row()], 'comma');
    expect(comma.charCodeAt(0)).toBe(0xfeff);
    const [header, line] = comma.slice(1).split('\r\n');
    expect(header).toBe(EXPORT_COLUMNS.map((c) => c.header).join(','));
    expect(line).toBe(
      'Huilerie Baccar,Amel Ben Salah,Directrice logistique,Olive oil,Sfax,+216 98 123 456,yes,amel@baccar.tn,https://baccar.tn,72,Found,2026-10-18,https://www.google.com/maps/search/?api=1&query=34.7%2C10.7',
    );
    const semi = toCsv([row({ company: 'Baccar; fils', role: 'Dit "chef"' })], 'semicolon');
    expect(semi.split('\r\n')[1]).toContain('"Baccar; fils";Amel Ben Salah;"Dit ""chef"""');
  });

  it('keeps French and Arabic text as typed', () => {
    const csv = toCsv([row({ company: 'Société générale', person: 'أمل بن صالح' })], 'comma');
    expect(Buffer.from(csv, 'utf8').toString('utf8')).toContain('Société générale,أمل بن صالح');
  });

  it('never lets a cell run as a formula, but leaves phone numbers alone', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizeFormula('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(neutralizeFormula('+cmd|calc')).toBe(`'+cmd|calc`);
    expect(neutralizeFormula('+216 98 123 456')).toBe('+216 98 123 456');
    expect(neutralizeFormula('-')).toBe('-');
  });
});

describe('XLSX', () => {
  it('is a real workbook with a frozen header, widths, links and the right rows', async () => {
    const rows = [row(), row({ company: 'Société 2', website: null, whatsapp: false })];
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(rows)) as unknown as ArrayBuffer);
    const sheet = book.getWorksheet('Leads')!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.getRow(1).getCell(1).value).toBe('Company');
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getColumn(1).width).toBeGreaterThan(10);
    expect(sheet.getRow(2).getCell(1).value).toBe('Huilerie Baccar');
    expect(sheet.getRow(3).getCell(1).value).toBe('Société 2');
    expect(sheet.getRow(3).getCell(7).value).toBe('no');
    expect(sheet.getRow(2).getCell(10).value).toBe(72);
    expect(sheet.getRow(2).getCell(9).value).toEqual({
      text: 'https://baccar.tn',
      hyperlink: 'https://baccar.tn',
    });
    expect(sheet.getRow(2).getCell(13).value).toMatchObject({ text: 'Open map' });
  });
});

describe('PDF', () => {
  it('embeds a font that has every French and Arabic letter it is asked to write', () => {
    // The table writes with this font; a missing glyph would print as an empty box.
    const doc = new PDFDocument();
    const require = createRequire(import.meta.url);
    doc.font(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'));
    const font = (
      doc as unknown as { _font: { font: { glyphsForString(s: string): { id: number }[] } } }
    )._font.font;
    for (const text of ['Société Générale à Sfax, éèêëàâçùûôïî œ « »', 'شركة زيت الزيتون، صفاقس']) {
      expect(font.glyphsForString(text).filter((g) => g.id === 0)).toEqual([]);
    }
  });

  it('writes a PDF with the font embedded and stops at its row limit', async () => {
    const pdf = await toPdf(
      Array.from({ length: EXPORT_PDF_MAX_ROWS + 20 }, (_, i) => row({ company: `Société ${i}` })),
      {
        title: 'Leads',
        filters: 'Search: huile',
        total: 800,
        now: new Date('2026-10-19T12:00:00Z'),
      },
    );
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+DejaVuSans/);
    expect(text).toContain('/FontFile2');
    // Landscape A4 pages, more than one, each with links for the site and the map.
    expect(text).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(5);
    expect(text).toContain('/URI (https://baccar.tn)');
  });
});

describe('visualOrder', () => {
  it('puts the words of an Arabic line right to left and keeps Latin and numbers readable', () => {
    expect(visualOrder(['Huilerie', 'Baccar'], false)).toEqual(['Huilerie', 'Baccar']);
    expect(visualOrder(['شركة', 'زيت', 'الزيتون'], true)).toEqual(['الزيتون', 'زيت', 'شركة']);
    expect(visualOrder(['شركة', 'زيت', '2', 'Sfax'], true)).toEqual(['2', 'Sfax', 'زيت', 'شركة']);
    expect(visualOrder(['Société', 'شركة', 'زيت', 'Sfax'], false)).toEqual([
      'Société',
      'زيت',
      'شركة',
      'Sfax',
    ]);
  });
});
