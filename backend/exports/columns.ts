import type { ExportRow } from '@lead-gen-crm/shared';

// The columns every export format shares, in order, with how each value is written as text.

export interface ExportColumn {
  key: keyof ExportRow;
  header: string;
  /** Rough width in characters, for the spreadsheet; the PDF reads it as a share of the page. */
  width: number;
  /** A link the cell's text points to (spreadsheet and PDF). */
  link?: (row: ExportRow) => string | null;
}

export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'company', header: 'Company', width: 26 },
  { key: 'person', header: 'Person', width: 20 },
  { key: 'role', header: 'Role', width: 20 },
  { key: 'sector', header: 'Sector', width: 18 },
  { key: 'city', header: 'City', width: 13 },
  { key: 'phone', header: 'Phone', width: 19 },
  { key: 'whatsapp', header: 'WhatsApp possible', width: 12 },
  { key: 'email', header: 'Email', width: 26 },
  {
    key: 'website',
    header: 'Website',
    width: 24,
    link: (r) => (r.website && /^https?:\/\//i.test(r.website) ? r.website : null),
  },
  { key: 'score', header: 'Score', width: 8 },
  { key: 'stage', header: 'Stage', width: 14 },
  { key: 'foundAt', header: 'Found', width: 13 },
  { key: 'mapsUrl', header: 'Google Maps', width: 12, link: (r) => r.mapsUrl },
];

/** The text of one cell: yes/no for WhatsApp, a day for the date, nothing for no value. */
export function cellText(row: ExportRow, key: keyof ExportRow): string {
  const value = row[key];
  if (key === 'whatsapp') return value ? 'yes' : 'no';
  if (key === 'foundAt') return typeof value === 'string' ? value.slice(0, 10) : '';
  if (value === null || value === undefined) return '';
  return String(value);
}

/** "leads-2026-10-19.csv" */
export const exportFileName = (ext: string, now = new Date()) =>
  `leads-${now.toISOString().slice(0, 10)}.${ext}`;
