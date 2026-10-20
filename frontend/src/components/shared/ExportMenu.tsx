import { EXPORT_PDF_MAX_ROWS, type CsvDelimiter, type ExportFormat } from '@lead-gen-crm/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { Popover } from './Popover.js';
import { ToggleGroup } from './ToggleGroup.js';
import './external.css';

type SheetFormat = Exclude<ExportFormat, 'pdf'>;

const PREFS_KEY = 'leadgen.export.prefs';

function readPrefs(): { sheet: SheetFormat; delimiter: CsvDelimiter } {
  // French-locale Excel (the people this is for) opens a semicolon CSV as columns.
  const fallback = { sheet: 'xlsx' as const, delimiter: 'semicolon' as const };
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as {
      sheet?: unknown;
      delimiter?: unknown;
    } | null;
    return {
      sheet: raw?.sheet === 'csv' ? 'csv' : fallback.sheet,
      delimiter: raw?.delimiter === 'comma' ? 'comma' : fallback.delimiter,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: { sheet: SheetFormat; delimiter: CsvDelimiter }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not kept: the next export starts from the defaults.
  }
}

/**
 * The Export button of a results panel: "Export 32 leads" with a small menu, a spreadsheet
 * (Excel or CSV, and the CSV separator) or a PDF table. The count is what the filters show now.
 */
export function ExportMenu({
  count,
  busy,
  onExport,
}: {
  count: number;
  busy: boolean;
  onExport: (format: ExportFormat, delimiter: CsvDelimiter) => void;
}) {
  const t = useT();
  const [prefs, setPrefs] = useState(readPrefs);
  const change = (next: Partial<typeof prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    writePrefs(merged);
  };
  const label = count === 1 ? t('export.button.one') : t('export.button', { count });
  const nothing = count === 0;

  return (
    <Popover label={label} icon={<Download size={16} aria-hidden="true" />} showLabel portal>
      {(close) => (
        <div className="export-panel">
          {nothing ? (
            <p className="muted">{t('export.nothing')}</p>
          ) : (
            <p className="muted small">{t('export.filters')}</p>
          )}
          <section aria-label={t('export.spreadsheet')}>
            <h3>{t('export.spreadsheet')}</h3>
            <ToggleGroup<SheetFormat>
              label={t('export.format')}
              hideLabel
              value={prefs.sheet}
              onChange={(sheet) => change({ sheet })}
              options={[
                { value: 'xlsx', label: t('export.xlsx') },
                { value: 'csv', label: t('export.csv') },
              ]}
            />
            {prefs.sheet === 'csv' && (
              <ToggleGroup<CsvDelimiter>
                label={t('export.separator')}
                value={prefs.delimiter}
                onChange={(delimiter) => change({ delimiter })}
                options={[
                  { value: 'semicolon', label: t('export.separator.semicolon') },
                  { value: 'comma', label: t('export.separator.comma') },
                ]}
              />
            )}
            <button
              type="button"
              className="button button-primary"
              disabled={busy || nothing}
              onClick={() => {
                close();
                onExport(prefs.sheet, prefs.delimiter);
              }}
            >
              {busy ? t('export.working') : t('export.download')}
            </button>
          </section>
          <section aria-label={t('export.pdf')}>
            <h3>{t('export.pdf')}</h3>
            {count > EXPORT_PDF_MAX_ROWS && (
              <p className="muted small">{t('export.pdf.limit', { max: EXPORT_PDF_MAX_ROWS })}</p>
            )}
            <button
              type="button"
              className="button"
              disabled={busy || nothing}
              onClick={() => {
                close();
                onExport('pdf', prefs.delimiter);
              }}
            >
              {busy ? t('export.working') : t('export.pdf.download')}
            </button>
          </section>
        </div>
      )}
    </Popover>
  );
}
