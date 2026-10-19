import type { Evidence, Lead } from '@lead-gen-crm/shared';
import { useT } from '../../../i18n/index.js';
import { formatDay, hostOf, safeHref } from '../../../lib/format.js';
import { CopyButton } from './CopyButton.js';
import { EvidenceDot } from './EvidenceDot.js';

/** Long ids ("ChIJ…", hashes) have no spaces to wrap at: they are cut short and can be copied. */
export const isLongId = (value: string): boolean =>
  /^[\w:.-]{24,}$/.test(value) && /\d/.test(value) && !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(value);

interface Row {
  field: string;
  value: string;
  kind: Evidence['kind'] | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

const fromEvidence = (e: Evidence): Row => ({
  field: e.field,
  value: e.value,
  kind: e.kind,
  sourceUrl: e.sourceUrl,
  fetchedAt: e.fetchedAt,
});

const newestFirst = (a: Evidence, b: Evidence) =>
  a.field.localeCompare(b.field) || b.fetchedAt.localeCompare(a.fetchedAt);

function ValueCell({ value }: { value: string }) {
  if (!isLongId(value)) return <span className="evidence-text">{value}</span>;
  return (
    <span className="evidence-id">
      <code title={value}>{value}</code>
      <CopyButton value={value} what="leadView.what.value" />
    </span>
  );
}

function SourceCell({ row }: { row: Row }) {
  if (!row.sourceUrl) return <span className="muted">—</span>;
  const href = safeHref(row.sourceUrl);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" title={row.sourceUrl}>
      {hostOf(row.sourceUrl)}
    </a>
  ) : (
    <span title={row.sourceUrl}>{row.sourceUrl}</span>
  );
}

/**
 * Every value behind the lead in one table: field, value, where it came from and when. Rows are
 * grouped under Person and Company. Values wrap; long ids are cut short with a copy button, so
 * the table never needs a sideways scroll.
 */
export function EvidenceTab({ lead }: { lead: Lead }) {
  const t = useT();
  const { company, contact } = lead;
  const record: [string, string | null | undefined][] = [
    [t('leadView.evidence.placeId'), company.googlePlaceId],
    [t('leadView.evidence.domain'), company.domain],
    [t('leadView.evidence.phoneE164'), company.phoneE164],
    [t('leadView.evidence.linkedin'), company.linkedinUrl],
    [t('leadView.evidence.region'), company.governorate],
    [t('leadView.evidence.sector'), company.sector],
  ];
  const groups: { id: string; title: string; rows: Row[] }[] = [
    ...(contact
      ? [
          {
            id: 'person',
            title: t('leadView.evidence.person'),
            rows: [...contact.evidence].sort(newestFirst).map(fromEvidence),
          },
        ]
      : []),
    {
      id: 'company',
      title: t('leadView.evidence.company'),
      rows: [...company.evidence].sort(newestFirst).map(fromEvidence),
    },
    {
      id: 'record',
      title: t('leadView.evidence.record'),
      rows: record
        .filter((r): r is [string, string] => Boolean(r[1]))
        .map(([field, value]) => ({
          field,
          value,
          kind: null,
          sourceUrl: null,
          fetchedAt: null,
        })),
    },
  ];

  return (
    <div className="lead-evidence">
      <table className="evidence-table" aria-label={t('leadView.evidence.groups')}>
        <thead>
          <tr>
            <th scope="col">{t('leadView.evidence.col.field')}</th>
            <th scope="col">{t('leadView.evidence.col.value')}</th>
            <th scope="col">{t('leadView.evidence.col.source')}</th>
            <th scope="col">{t('leadView.evidence.col.date')}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.id} aria-label={g.title}>
            <tr className="evidence-group">
              <th scope="colgroup" colSpan={4}>
                {g.title} <span className="muted">({g.rows.length})</span>
              </th>
            </tr>
            {g.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {t('lead.evidence.none')}
                </td>
              </tr>
            ) : (
              g.rows.map((row, i) => (
                <tr key={`${row.field}-${i}`}>
                  <th scope="row" className="evidence-field">
                    {row.field}
                  </th>
                  <td>
                    <span className="evidence-value-cell">
                      <ValueCell value={row.value} />
                      {row.kind !== null && <EvidenceDot kind={row.kind} />}
                    </span>
                  </td>
                  <td className="evidence-src">
                    <SourceCell row={row} />
                  </td>
                  <td className="evidence-date">
                    {row.fetchedAt ? (
                      <time dateTime={row.fetchedAt}>{formatDay(row.fetchedAt)}</time>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}
