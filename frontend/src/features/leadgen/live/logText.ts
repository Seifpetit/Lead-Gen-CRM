import type { RunLogLine } from '@lead-gen-crm/shared';

/** What the level filter keeps: everything, warnings and errors, or errors only. */
export type LevelFilter = 'all' | 'warn' | 'error';

const RANK = { info: 0, warn: 1, error: 2 } as const;
const MIN_RANK: Record<LevelFilter, number> = { all: 0, warn: 1, error: 2 };

/** The lines of a log that pass the level filter and contain the search text (any letter case). */
export function filterLog(
  lines: readonly RunLogLine[],
  level: LevelFilter,
  query: string,
): RunLogLine[] {
  const needle = query.trim().toLowerCase();
  if (level === 'all' && needle === '') return lines as RunLogLine[];
  return lines.filter(
    (line) =>
      RANK[line.level] >= MIN_RANK[level] &&
      (needle === '' || line.message.toLowerCase().includes(needle)),
  );
}

/** "10:03:41", in UTC like every other time in the app. */
export function logTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19);
}

/** One line as plain text: the full time stamp, the level, the message. */
export function logLineText(line: RunLogLine): string {
  return `${line.at} ${line.level.toUpperCase().padEnd(5)} ${line.message}`;
}

export const logToText = (lines: readonly RunLogLine[]): string =>
  lines.map(logLineText).join('\n') + (lines.length > 0 ? '\n' : '');

/** A safe name for the downloaded file: run-log-sfax-20261019-1603.txt. */
export function logFileName(region: string, now = new Date()): string {
  const slug =
    region
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-') || 'run';
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `run-log-${slug}-${stamp}.txt`;
}
