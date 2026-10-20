import type { CsvDelimiter, ExportFormat } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { useApi } from '../../api/context.js';
import type { ExportSource } from '../../api/endpoints.js';
import { ExportMenu } from '../../components/shared/ExportMenu.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';

/** Hands a downloaded file to the browser as a save. */
function save(blob: Blob, fileName: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The Export button for one results panel; the server builds the file with the panel's filters. */
export function ExportButton({ source, count }: { source: ExportSource; count: number }) {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat, delimiter: CsvDelimiter) => {
    setBusy(true);
    try {
      const { blob, fileName } = await api.exports.download(source, format, delimiter);
      save(blob, fileName);
      toast.show(t('export.done', { file: fileName }));
    } catch (err) {
      toast.show(t('export.failed', { reason: describeError(t, err) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return <ExportMenu count={count} busy={busy} onExport={(f, d) => void run(f, d)} />;
}
