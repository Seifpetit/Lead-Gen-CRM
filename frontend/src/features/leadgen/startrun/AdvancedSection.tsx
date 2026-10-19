import type { RunPreview } from '@lead-gen-crm/shared';
import { useId } from 'react';
import { useT } from '../../../i18n/index.js';
import { formatNumber } from '../../../lib/format.js';

/** Mirrors the server's limits on typed-in wordings. */
export const MAX_CUSTOM_WORDINGS = 20;
export const MAX_WORDING_CHARS = 80;

/** One wording per line; blank lines and repeated spaces are ignored. */
export function parseWordings(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

export function wordingsProblem(wordings: string[]): 'tooMany' | 'tooLong' | null {
  if (wordings.length > MAX_CUSTOM_WORDINGS) return 'tooMany';
  if (wordings.some((w) => w.length > MAX_WORDING_CHARS)) return 'tooLong';
  return null;
}

/**
 * Everything most runs do not need, behind one closed "Advanced": extra searches typed in, the
 * searches that will run (grouped by cell), and how the estimate was made.
 */
/** "ben-arous" as "Ben Arous". */
const regionName = (id: string): string =>
  id.replace(/-/g, ' ').replace(/\b\p{L}/gu, (c) => c.toLocaleUpperCase());

export function AdvancedSection({
  preview,
  stale,
  wordingsText,
  setWordingsText,
  problem,
  cellKeys,
  clearCells,
}: {
  preview: RunPreview | null;
  stale: boolean;
  wordingsText: string;
  setWordingsText: (text: string) => void;
  problem: 'tooMany' | 'tooLong' | null;
  cellKeys: string[];
  clearCells: () => void;
}) {
  const t = useT();
  const wordingsId = useId();
  const sectorName = (id: string | null) =>
    id === null ? t('plan.custom') : (preview?.sectors.find((s) => s.id === id)?.name ?? id);

  // Cells of different regions share names (r0c0), so the region is part of the group's key.
  const byCell = new Map<string, RunPreview['queries']>();
  for (const q of preview?.queries ?? []) {
    const key = `${q.regionId ?? ''}|${q.cellKey}`;
    byCell.set(key, [...(byCell.get(key) ?? []), q]);
  }

  return (
    <details className="sr-advanced">
      <summary>{t('start.advanced')}</summary>
      <div className="sr-advanced-body">
        <div className="form-field">
          <label htmlFor={wordingsId}>{t('plan.wordings')}</label>
          <textarea
            id={wordingsId}
            rows={3}
            value={wordingsText}
            onChange={(e) => setWordingsText(e.target.value)}
            aria-describedby={`${wordingsId}-help`}
            aria-invalid={problem !== null}
          />
          <small id={`${wordingsId}-help`} className={problem !== null ? 'form-error' : 'muted'}>
            {problem === 'tooMany'
              ? t('plan.wordings.tooMany', { max: MAX_CUSTOM_WORDINGS })
              : problem === 'tooLong'
                ? t('plan.wordings.tooLong', { max: MAX_WORDING_CHARS })
                : t('plan.wordings.help', { max: MAX_CUSTOM_WORDINGS, chars: MAX_WORDING_CHARS })}
          </small>
        </div>

        {cellKeys.length > 0 && (
          <p className="notice" role="status">
            {t('plan.cells', { cells: cellKeys.join(', ') })}{' '}
            <button type="button" className="link-button" onClick={clearCells}>
              {t('plan.cells.clear')}
            </button>
          </p>
        )}

        {preview && (
          <details className={stale ? 'is-stale' : ''}>
            <summary>
              {t('plan.queries', {
                total: formatNumber(preview.queriesTotal),
              })}
            </summary>
            {[...byCell.entries()].map(([group, list]) => (
              <div key={group} className="plan-cell">
                <h4>
                  {t('plan.cell', {
                    cell: list[0]!.regionId
                      ? `${regionName(list[0]!.regionId)} ${list[0]!.cellKey}`
                      : list[0]!.cellKey,
                  })}
                </h4>
                <ul>
                  {list.map((q) => (
                    <li key={`${group}|${q.wording}|${q.sectorId ?? ''}`}>
                      {q.wording} <span className="muted">({sectorName(q.sectorId)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {preview.queriesTotal > preview.queries.length && (
              <p className="muted">
                {t('plan.more', {
                  count: formatNumber(preview.queriesTotal - preview.queries.length),
                })}
              </p>
            )}
          </details>
        )}

        {preview && (
          <details>
            <summary>{t('start.preview.assumptions')}</summary>
            <ul>
              {preview.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
