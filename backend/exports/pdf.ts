import { EXPORT_PDF_MAX_ROWS, type ExportRow } from '@lead-gen-crm/shared';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { isRtl, visualOrder } from './bidi.js';
import { cellText, EXPORT_COLUMNS } from './columns.js';

// A readable landscape table: the app's name, the date, what the filters were, then the rows
// with long values wrapped, the header repeated on each page and "Page 2 of 5" at the bottom.
// DejaVu Sans is embedded because it carries French accents and Arabic letters in one font.

const require = createRequire(import.meta.url);
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const MARGIN = 28;
const FONT_SIZE = 7;
const LINE = 9;
const PAD = 3;
const INK = '#111111';
const LINK = '#1d4ed8';
const RULE = '#9a9a9a';
const HEADER_FILL = '#fdf1e8';

export interface PdfMeta {
  /** "Leads" or the page the export was made from. */
  title: string;
  /** What the filters were, already worded ("Search: huile · Min score 40"); empty for none. */
  filters: string;
  /** Everything that matched; more than the rows when the PDF was cut at its limit. */
  total: number;
  now?: Date;
}

type Doc = PDFKit.PDFDocument;

/** Splits a word that is wider than the column into pieces that fit. */
function splitLong(doc: Doc, word: string, width: number): string[] {
  if (doc.widthOfString(word) <= width) return [word];
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && doc.widthOfString(piece + ch) > width) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** The text as lines of words (reading order) that fit the width. */
export function wrapWords(doc: Doc, text: string, width: number): string[][] {
  const lines: string[][] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line: string[] = [];
    let used = 0;
    const space = doc.widthOfString(' ');
    for (const raw of paragraph.split(/\s+/).filter(Boolean)) {
      for (const word of splitLong(doc, raw, width)) {
        const w = doc.widthOfString(word);
        if (line.length > 0 && used + space + w > width) {
          lines.push(line);
          line = [];
          used = 0;
        }
        used += (line.length > 0 ? space : 0) + w;
        line.push(word);
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines.length > 0 ? lines : [[]];
}

/** Draws wrapped lines inside a cell; right-to-left text is right-aligned. */
function drawLines(doc: Doc, lines: string[][], x: number, y: number, width: number, rtl: boolean) {
  const space = doc.widthOfString(' ');
  lines.forEach((line, n) => {
    const words = visualOrder(line, rtl);
    const total =
      words.reduce((sum, w) => sum + doc.widthOfString(w), 0) + space * (words.length - 1);
    let cx = rtl ? x + width - total : x;
    for (const word of words) {
      doc.text(word, cx, y + n * LINE, { lineBreak: false });
      cx += doc.widthOfString(word) + space;
    }
  });
}

export async function toPdf(allRows: readonly ExportRow[], meta: PdfMeta): Promise<Buffer> {
  const now = meta.now ?? new Date();
  const rows = allRows.slice(0, EXPORT_PDF_MAX_ROWS);
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: `Lead Gen CRM - ${meta.title}`, Creator: 'Lead Gen CRM' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.registerFont('body', FONT);
  doc.registerFont('bold', FONT_BOLD);
  const pageWidth = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN - 14;
  const weight = EXPORT_COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const widths = EXPORT_COLUMNS.map((c) => (c.width / weight) * pageWidth);
  const lefts = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

  // Title, date, filters and the limit note.
  doc.font('bold').fontSize(14).fillColor(INK).text(`Lead Gen CRM - ${meta.title}`, MARGIN, MARGIN);
  doc.font('body').fontSize(8);
  const stamp = `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const count = meta.total === 1 ? '1 lead' : `${meta.total.toLocaleString('en-US')} leads`;
  let y = doc.y + 4;
  const intro = [
    `Exported ${stamp} · ${count}`,
    meta.filters ? `Filters: ${meta.filters}` : 'No filters',
  ];
  if (meta.total > rows.length) {
    intro.push(
      `This PDF shows the first ${rows.length.toLocaleString('en-US')} of ${meta.total.toLocaleString('en-US')} leads. Export a spreadsheet to get all of them.`,
    );
  }
  for (const text of intro) {
    const lines = wrapWords(doc, text, pageWidth);
    drawLines(doc, lines, MARGIN, y, pageWidth, isRtl(text));
    y += lines.length * 11;
  }
  y += 6;

  const drawHeader = () => {
    doc.font('bold').fontSize(FONT_SIZE);
    const wrapped = EXPORT_COLUMNS.map((c, i) => wrapWords(doc, c.header, widths[i]! - PAD * 2));
    const height = Math.max(...wrapped.map((l) => l.length)) * LINE + PAD * 2;
    doc.rect(MARGIN, y, pageWidth, height).fillAndStroke(HEADER_FILL, INK);
    doc.fillColor(INK);
    wrapped.forEach((lines, i) =>
      drawLines(doc, lines, lefts[i]! + PAD, y + PAD, widths[i]! - PAD * 2, false),
    );
    y += height;
    doc.font('body').fontSize(FONT_SIZE);
  };
  drawHeader();

  if (rows.length === 0) {
    doc.fillColor(INK).text('No leads match these filters.', MARGIN, y + 8, { lineBreak: false });
  }

  for (const row of rows) {
    const cells = EXPORT_COLUMNS.map((c, i) => {
      const text = c.key === 'mapsUrl' ? (row.mapsUrl ? 'Open map' : '') : cellText(row, c.key);
      return {
        text,
        lines: wrapWords(doc, text, widths[i]! - PAD * 2),
        link: c.link?.(row) ?? null,
      };
    });
    const height = Math.max(...cells.map((c) => c.lines.length)) * LINE + PAD * 2;
    if (y + height > bottom) {
      doc.addPage();
      y = MARGIN;
      drawHeader();
    }
    doc
      .lineWidth(0.4)
      .strokeColor(RULE)
      .moveTo(MARGIN, y + height)
      .lineTo(MARGIN + pageWidth, y + height)
      .stroke();
    cells.forEach((cell, i) => {
      doc.fillColor(cell.link ? LINK : INK);
      drawLines(doc, cell.lines, lefts[i]! + PAD, y + PAD, widths[i]! - PAD * 2, isRtl(cell.text));
      if (cell.link && cell.text) doc.link(lefts[i]!, y, widths[i]!, height, cell.link);
    });
    y += height;
  }

  // Page numbers last, when the number of pages is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // The footer sits in the bottom margin; writing there must not start another page.
    doc.page.margins.bottom = 0;
    doc.font('body').fontSize(7).fillColor(INK);
    const label = `Page ${i + 1} of ${range.count}`;
    doc.text(label, doc.page.width - MARGIN - doc.widthOfString(label), doc.page.height - MARGIN, {
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}
