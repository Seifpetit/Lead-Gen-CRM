import type { Company, Contact, Evidence } from '@lead-gen-crm/shared';
import { useT } from '../i18n/index.js';
import { channelHref, type Channel } from '../lib/lead.js';
import { evidenceFor, safeHref } from '../lib/format.js';
import { Field, KindTag, SourceNote } from './Evidence.js';

export function LinkValue({ url }: { url: string }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {url.replace(/^https?:\/\/(www\.)?/, '')}
    </a>
  ) : (
    <>{url}</>
  );
}

export function ChannelField({ label, channel }: { label: string; channel: Channel | null }) {
  const t = useT();
  if (!channel) return <Field label={label} value={null} evidence={null} />;
  const href = channelHref(channel);
  return (
    <Field
      label={label}
      value={channel.value}
      evidence={channel.evidence}
      display={
        <>
          <span className="channel-kind">{t(`lead.channel.${channel.kind}`)}: </span>
          {channel.kind === 'linkedin' ? (
            <LinkValue url={channel.value} />
          ) : href ? (
            <a href={href}>{channel.value}</a>
          ) : (
            channel.value
          )}
        </>
      }
    />
  );
}

/** A company's name field: its source is the listing the company was found on. */
export function companyNameField(company: Company) {
  return evidenceFor(company.evidence, ['name', 'placeId'], company.name);
}

export function personNameEvidence(contact: Contact) {
  return evidenceFor(contact.evidence, ['fullName', 'linkedinUrl'], contact.fullName);
}

/** Every piece of evidence behind a lead, grouped by who it is about. */
export function EvidenceList({
  title,
  evidence,
}: {
  title: string;
  evidence: readonly Evidence[];
}) {
  const t = useT();
  return (
    <div className="evidence-group">
      <h4>{title}</h4>
      {evidence.length === 0 ? (
        <p className="muted">{t('lead.evidence.none')}</p>
      ) : (
        <ul className="evidence-list">
          {[...evidence]
            .sort(
              (a, b) => a.field.localeCompare(b.field) || b.fetchedAt.localeCompare(a.fetchedAt),
            )
            .map((e, i) => (
              <li key={`${e.field}-${i}`}>
                <span className="evidence-field">{e.field}</span>: <span>{e.value}</span>{' '}
                <KindTag kind={e.kind} />
                <br />
                <SourceNote evidence={e} />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
