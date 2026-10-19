import type { ExportRow } from '@lead-gen-crm/shared';
import ExcelJS from 'exceljs';
import { cellText, EXPORT_COLUMNS } from './columns.js';

/** A real .xlsx: a bold frozen header row, set column widths and clickable links. */
export async function toXlsx(rows: readonly ExportRow[], now = new Date()): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Lead Gen CRM';
  book.created = now;
  const sheet = book.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF1E8' } };

  for (const row of rows) {
    const added = sheet.addRow(
      Object.fromEntries(
        EXPORT_COLUMNS.map((c) => [c.key, c.key === 'score' ? row.score : cellText(row, c.key)]),
      ),
    );
    EXPORT_COLUMNS.forEach((c, i) => {
      const link = c.link?.(row);
      if (!link) return;
      const cell = added.getCell(i + 1);
      cell.value = {
        text: c.key === 'mapsUrl' ? 'Open map' : cellText(row, c.key),
        hyperlink: link,
      };
      cell.font = { color: { argb: 'FF1D4ED8' }, underline: true };
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };
  return Buffer.from(await book.xlsx.writeBuffer());
}
