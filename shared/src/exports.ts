// Exporting leads: the formats, their limits, and the columns every format shares.

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** French-locale Excel splits CSV on semicolons; everything else expects commas. */
export const CSV_DELIMITERS = ['comma', 'semicolon'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** The most rows one export holds; the server reads them a page at a time. */
export const EXPORT_MAX_ROWS = 10_000;
/** A PDF table stops here, with a line above the table that says so. */
export const EXPORT_PDF_MAX_ROWS = 500;

/** One exported lead. No internal ids and nothing secret. */
export interface ExportRow {
  company: string;
  person: string | null;
  role: string | null;
  sector: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: boolean;
  email: string | null;
  website: string | null;
  score: number | null;
  stage: string;
  /** ISO 8601. */
  foundAt: string;
  mapsUrl: string | null;
}

/** A Google Maps address for a business: its coordinates when known, otherwise its name. */
export function googleMapsUrl(
  name: string,
  location: { lat: number; lng: number } | null | undefined,
  city?: string | null,
): string {
  const query = location
    ? `${location.lat},${location.lng}`
    : [name, city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
