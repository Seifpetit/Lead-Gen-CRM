import { maskCredentials, regionLabel, runOutcome, type RunLogLine } from '@lead-gen-crm/shared';
import type { RunSummary } from '@lead-gen-crm/shared';
import type { StringKey, Translate } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { logToText } from '../live/logText.js';

/** One run to export: the run and every line of its log. */
export interface ExportedRun {
  run: RunSummary;
  lines: readonly RunLogLine[];
}

/** The line between two runs. */
export const RUN_SEPARATOR = '='.repeat(72);

/**
 * "Run <id> | Sfax | Textile | Started 2026-10-19T09:00:00.000Z | Completed with leads | Spent
 * $0.55 of $2.00": what a person needs to tell the runs apart, in the words the Logs page uses.
 */
export function exportHeader(
  t: Translate,
  run: RunSummary,
  sectorName: (id: string) => string,
): string {
  const sectors =
    run.sectors.length > 0
      ? run.sectors.map(sectorName).join(', ')
      : run.customOnly
        ? t('grid.other')
        : t('cov.history.allSectors');
  return t('logs.export.header', {
    id: run.id,
    region: regionLabel(run.region),
    sectors,
    started: run.createdAt,
    outcome: t(`outcome.${runOutcome(run).kind}` as StringKey),
    spent: t('money.spentOfCap', {
      spent: formatUsd(run.spentUsd),
      cap: formatUsd(run.budgetCapUsd),
    }),
  });
}

/**
 * The text of the Logs export: one block per run, newest first. A block is the header line, then
 * the run's log lines exactly as the log window copies them (`logToText`). Blocks are separated
 * by a blank line, a line of "=" and a blank line. The whole text goes through the credential
 * mask once more, so a token that slipped into a line still never leaves the app.
 */
export function exportText(
  t: Translate,
  runs: readonly ExportedRun[],
  sectorName: (id: string) => string = (id) => id,
): string {
  const blocks = [...runs]
    .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt))
    .map(({ run, lines }) => {
      const body = lines.length > 0 ? logToText(lines) : `${t('logs.export.empty')}\n`;
      return `${exportHeader(t, run, sectorName)}\n${body}`;
    });
  return maskCredentials(blocks.join(`\n${RUN_SEPARATOR}\n\n`));
}

/** leadgen-logs-2026-10-20.txt */
export const exportFileName = (now = new Date()): string =>
  `leadgen-logs-${now.toISOString().slice(0, 10)}.txt`;
