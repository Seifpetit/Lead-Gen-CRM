import type { CsvDelimiter, ExportRow } from '@lead-gen-crm/shared';
import { cellText, EXPORT_COLUMNS } from './columns.js';

const BOM = '\uFEFF';

/**
 * A spreadsheet program must never run a cell as a formula. A value starting with = or @ (or a
 * tab or return) gets a leading apostrophe; so does one starting with + or - unless it is
 * plainly a number such as "+216 98 123 456".
 */
export function neutralizeFormula(text: string): string {
  if (/^[=@\t\r]/.test(text)) return `'${text}`;
  if (/^[+-]/.test(text) && !/^[+-][\d\s().]*$/.test(text)) return `'${text}`;
  return text;
}

function quote(text: string, separator: string): string {
  const safe = neutralizeFormula(text);
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 with a byte order mark (so Excel reads accents and Arabic), one header row. */
export function toCsv(rows: readonly ExportRow[], delimiter: CsvDelimiter): string {
  const sep = delimiter === 'semicolon' ? ';' : ',';
  const lines = [
    EXPORT_COLUMNS.map((c) => quote(c.header, sep)).join(sep),
    ...rows.map((row) => EXPORT_COLUMNS.map((c) => quote(cellText(row, c.key), sep)).join(sep)),
  ];
  return BOM + lines.join('\r\n') + '\r\n';
}
