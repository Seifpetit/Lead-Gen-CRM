import type { Evidence } from '@lead-gen-crm/shared';
import { BookOpenText } from 'lucide-react';
import { Popover } from '../../../components/shared/Popover.js';
import { useT } from '../../../i18n/index.js';
import { formatDateTime, hostOf, safeHref } from '../../../lib/format.js';
import { EvidenceDot } from './EvidenceDot.js';

function Group({ title, evidence }: { title: string; evidence: readonly Evidence[] }) {
  const t = useT();
  if (evidence.length === 0) return null;
  const sorted = [...evidence].sort((a, b) => a.field.localeCompare(b.field));
  return (
    <section>
      <h3>{title}</h3>
      <ul className="sources-list">
        {sorted.map((e, i) => {
          const href = safeHref(e.sourceUrl);
          return (
            <li key={`${e.field}-${i}`}>
              <EvidenceDot kind={e.kind} />
              <span className="sources-field">{e.field}</span>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {hostOf(e.sourceUrl)}
                </a>
              ) : (
                <span>{e.sourceUrl}</span>
              )}
              <time dateTime={e.fetchedAt} className="muted">
                {t('leadView.sources.read', { time: formatDateTime(e.fetchedAt) })}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One list of where every value on the page was read, instead of a source under each value. */
export function SourcesPopover({
  company,
  person,
}: {
  company: readonly Evidence[];
  person: readonly Evidence[];
}) {
  const t = useT();
  return (
    <Popover
      label={t('leadView.sources')}
      showLabel
      align="left"
      portal
      icon={<BookOpenText size={16} aria-hidden="true" />}
    >
      <div className="sources-panel">
        <h2 className="sources-title">{t('leadView.sources.title')}</h2>
        {company.length + person.length === 0 && (
          <p className="muted">{t('leadView.sources.none')}</p>
        )}
        <Group title={t('leadView.sources.company')} evidence={company} />
        <Group title={t('leadView.sources.person')} evidence={person} />
      </div>
    </Popover>
  );
}
