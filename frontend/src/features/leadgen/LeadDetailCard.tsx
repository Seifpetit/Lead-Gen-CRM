import type { Lead } from '@lead-gen-crm/shared';
import {
  ChannelField,
  companyNameField,
  EvidenceList,
  LinkValue,
  personNameEvidence,
} from '../../components/LeadFields.js';
import { Field, KindTag } from '../../components/Evidence.js';
import { useT } from '../../i18n/index.js';
import { evidenceFor } from '../../lib/format.js';
import { bestChannel, companyChannels } from '../../lib/lead.js';
import { LeadActions } from '../crm/LeadActions.js';

const MAX = { companyFit: 50, contactFit: 30, reachability: 20 } as const;

/** One lead in a run: the person first, then the company as the fallback, then the score. */
export function LeadDetailCard({
  lead,
  onMoved,
}: {
  lead: Lead;
  onMoved: (lead: Lead, note: string | null) => void;
}) {
  const t = useT();
  const { contact, company } = lead;
  const channel = bestChannel(contact);
  const fallback = companyChannels(company);
  const heading = contact?.fullName ?? company.name;

  return (
    <article className="lead-card" aria-label={heading}>
      <header className="lead-card-head">
        <h3>{heading}</h3>
        <span className="score-total" title={t('lead.score')}>
          {t('lead.score.total', { total: lead.score.total })} <KindTag kind="estimate" />
        </span>
      </header>

      <section aria-label={t('lead.people')}>
        <h4>{t('lead.people')}</h4>
        {contact ? (
          <dl className="fields">
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
            <Field
              label={t('lead.linkedin')}
              value={contact.linkedinUrl}
              evidence={evidenceFor(contact.evidence, 'linkedinUrl', contact.linkedinUrl)}
              display={contact.linkedinUrl ? <LinkValue url={contact.linkedinUrl} /> : null}
            />
            <ChannelField label={t('lead.bestChannel')} channel={channel} />
            <div className="field">
              <dt>{t('lead.currentRole')}</dt>
              <dd>
                {contact.currentRoleVerified
                  ? t('lead.currentRole.verified')
                  : t('lead.currentRole.unverified')}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">{t('lead.noContact')}</p>
        )}
        {contact && !channel && <p className="muted">{t('lead.noChannel')}</p>}
      </section>

      <section aria-label={t('lead.company')}>
        <h4>{t('lead.company.fallback')}</h4>
        <dl className="fields">
          <Field
            label={t('lead.company.name')}
            value={company.name}
            evidence={companyNameField(company)}
          />
          <Field
            label={t('lead.company.governorate')}
            value={company.governorate}
            evidence={evidenceFor(
              company.evidence,
              ['governorate', 'placeId'],
              company.governorate,
            )}
          />
          <Field
            label={t('lead.company.sector')}
            value={company.sector}
            evidence={evidenceFor(company.evidence, 'sector', company.sector)}
          />
          <Field
            label={t('lead.company.website')}
            value={company.website}
            evidence={evidenceFor(company.evidence, 'website', company.website)}
            display={company.website ? <LinkValue url={company.website} /> : null}
          />
          {fallback.length === 0 ? (
            <Field label={t('lead.company.phone')} value={null} evidence={null} />
          ) : (
            fallback.map((c) => (
              <ChannelField
                key={c.kind}
                label={t(`lead.company.${c.kind === 'phone' ? 'phone' : 'email'}`)}
                channel={c}
              />
            ))
          )}
        </dl>
      </section>

      <section aria-label={t('lead.score')}>
        <h4>{t('lead.score')}</h4>
        <ul className="score-parts">
          {(['companyFit', 'contactFit', 'reachability'] as const).map((part) => (
            <li key={part}>
              <span>{t(`lead.score.${part}`)}</span>
              <progress max={MAX[part]} value={lead.score[part]} aria-hidden="true" />
              <span>{t('lead.score.outOf', { value: lead.score[part], max: MAX[part] })}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">{t('lead.score.estimate')}</p>
        <details>
          <summary>{t('lead.evidence')}</summary>
          {contact && (
            <EvidenceList title={t('lead.evidence.person')} evidence={contact.evidence} />
          )}
          <EvidenceList title={t('lead.evidence.company')} evidence={company.evidence} />
        </details>
      </section>

      <footer>
        <LeadActions lead={lead} name={heading} onMoved={onMoved} />
        <p className="muted small">{t('lead.dismissNote')}</p>
      </footer>
    </article>
  );
}
