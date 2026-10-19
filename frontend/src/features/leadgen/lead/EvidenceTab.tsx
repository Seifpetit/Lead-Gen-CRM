import type { Evidence, Lead } from '@lead-gen-crm/shared';
import { useT } from '../../../i18n/index.js';
import { formatDateTime, hostOf, safeHref } from '../../../lib/format.js';
import { EvidenceDot } from './EvidenceDot.js';

function Group({ title, evidence }: { title: string; evidence: readonly Evidence[] }) {
  const t = useT();
  const sorted = [...evidence].sort(
    (a, b) => a.field.localeCompare(b.field) || b.fetchedAt.localeCompare(a.fetchedAt),
  );
  return (
    <details className="evidence-fold">
      <summary>
        <span>{title}</span>
        <span className="muted">{t('leadView.evidence.count', { count: evidence.length })}</span>
      </summary>
      {sorted.length === 0 ? (
        <p className="muted">{t('lead.evidence.none')}</p>
      ) : (
        <ul className="evidence-rows">
          {sorted.map((e, i) => {
            const href = safeHref(e.sourceUrl);
            return (
              <li key={`${e.field}-${i}`}>
                <span className="evidence-field">{e.field}</span>
                <span className="evidence-value">{e.value}</span>
                <EvidenceDot kind={e.kind} />
                <span className="muted evidence-src">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {hostOf(e.sourceUrl)}
                    </a>
                  ) : (
                    e.sourceUrl
                  )}
                  {' · '}
                  <time dateTime={e.fetchedAt}>{formatDateTime(e.fetchedAt)}</time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

/** The raw values behind the lead, one fold per group, all closed until opened. */
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
  const fields = record.filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <div className="lead-evidence" role="group" aria-label={t('leadView.evidence.groups')}>
      {contact && <Group title={t('lead.evidence.person')} evidence={contact.evidence} />}
      <Group title={t('lead.company')} evidence={company.evidence} />
      <details className="evidence-fold">
        <summary>
          <span>{t('leadView.evidence.record')}</span>
          <span className="muted">{t('leadView.evidence.count', { count: fields.length })}</span>
        </summary>
        <ul className="evidence-rows">
          {fields.map(([label, value]) => (
            <li key={label}>
              <span className="evidence-field">{label}</span>
              <span className="evidence-value">{value}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
