import type { Evidence } from '@lead-gen-crm/shared';
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { formatDateTime, hostOf, safeHref } from '../lib/format.js';

/** Fact or Estimate, as text first and colour second. */
export function KindTag({ kind }: { kind: Evidence['kind'] }) {
  const t = useT();
  return (
    <span
      className={`tag tag-${kind}`}
      title={kind === 'fact' ? t('tag.factHelp') : t('tag.estimateHelp')}
    >
      {kind === 'fact' ? t('tag.fact') : t('tag.estimate')}
    </span>
  );
}

/** Where a value was read and when. */
export function SourceNote({ evidence }: { evidence: Evidence }) {
  const t = useT();
  const href = safeHref(evidence.sourceUrl);
  return (
    <span className="source">
      <span className="visually-hidden">{t('tag.source')}: </span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {hostOf(evidence.sourceUrl)}
        </a>
      ) : (
        <span>{evidence.sourceUrl}</span>
      )}
      {' · '}
      <time dateTime={evidence.fetchedAt}>
        {t('tag.readAt', { time: formatDateTime(evidence.fetchedAt) })}
      </time>
    </span>
  );
}

/**
 * A labelled value with its Fact or Estimate tag, source and time. A missing value says so; it
 * is never filled in. A value without evidence says that too, rather than borrowing a source.
 */
export function Field({
  label,
  value,
  evidence,
  display,
}: {
  label: string;
  value: string | null | undefined;
  evidence: Evidence | null;
  /** How to render the value itself (a link, say); defaults to the text. */
  display?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>
        {value ? (
          <>
            <span className="field-value">{display ?? value}</span>
            {evidence ? (
              <>
                {' '}
                <KindTag kind={evidence.kind} />
                <br />
                <SourceNote evidence={evidence} />
              </>
            ) : (
              <>
                {' '}
                <span className="tag tag-missing">{t('tag.noSource')}</span>
              </>
            )}
          </>
        ) : (
          <span className="muted">{t('common.notFound')}</span>
        )}
      </dd>
    </div>
  );
}
