import type { Lead } from '@lead-gen-crm/shared';
import { Link } from 'react-router';
import { Field, KindTag } from '../../components/Evidence.js';
import { ChannelField, companyNameField, personNameEvidence } from '../../components/LeadFields.js';
import { useT } from '../../i18n/index.js';
import { evidenceFor, safeHref } from '../../lib/format.js';
import { bestChannel, mapsSourceUrl } from '../../lib/lead.js';
import { LeadActions } from './LeadActions.js';

/** A pipeline card: the person and best channel first, the company, the score, the controls. */
export function LeadCard({
  lead,
  onMoved,
}: {
  lead: Lead;
  onMoved: (lead: Lead, note: string | null) => void;
}) {
  const t = useT();
  const { contact, company } = lead;
  const name = contact?.fullName ?? company.name;
  const mapsUrl = mapsSourceUrl(company);
  return (
    <li className="card" aria-label={name}>
      <dl className="fields">
        {contact ? (
          <>
            <Field
              label={t('lead.name')}
              value={contact.fullName}
              evidence={personNameEvidence(contact)}
            />
            <Field
              label={t('lead.title')}
              value={contact.title}
              evidence={evidenceFor(contact.evidence, 'title', contact.title)}
            />
            <ChannelField label={t('lead.bestChannel')} channel={bestChannel(contact)} />
          </>
        ) : (
          <p className="muted">{t('crm.card.noContact')}</p>
        )}
        <Field
          label={t('lead.company.name')}
          value={company.name}
          evidence={companyNameField(company)}
        />
        {mapsUrl && (
          <div className="field">
            <dt>{t('lead.company.source')}</dt>
            <dd>
              <a href={safeHref(mapsUrl) ?? undefined} target="_blank" rel="noreferrer noopener">
                {t('lead.company.source.maps')}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <p className="card-meta">
        <span>
          {t('crm.card.score', { total: lead.score.total })} <KindTag kind="estimate" />
        </span>{' '}
        <Link to={`/leadgen/runs/${lead.runId}`}>{t('crm.card.openRun')}</Link>
      </p>
      <LeadActions lead={lead} name={name} onMoved={onMoved} />
    </li>
  );
}
