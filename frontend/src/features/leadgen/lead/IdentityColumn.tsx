import type { CompanyCardDetail, Evidence, Lead } from '@lead-gen-crm/shared';
import { regionLabel } from '@lead-gen-crm/shared';
import { Globe, Info, Mail, MapPin, MapPinned, Phone, SquareArrowOutUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';
import { evidenceFor, safeHref } from '../../../lib/format.js';
import { channelHref, mapsSourceUrl } from '../../../lib/lead.js';
import { CompanyThumb } from '../../crm/BoardCard.js';
import { CopyButton } from './CopyButton.js';
import { DotLegend, EvidenceDot } from './EvidenceDot.js';
import { SourcesPopover } from './SourcesPopover.js';
import { ExternalLink } from '../../../components/shared/ExternalLink.js';
import { WhatsAppButton } from '../../outreach/WhatsAppButton.js';

const ICON = 16;

function Row({
  icon,
  label,
  evidence,
  actions,
  empty = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  /** Left out for a value with no source to point at. */
  evidence?: Evidence | null | undefined;
  actions?: ReactNode;
  /** Nothing to show for this channel: the row is greyed. */
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`lead-row${empty ? ' is-empty' : ''}`}>
      <span className="lead-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="visually-hidden">{label}: </span>
      <span className="lead-row-value">{children}</span>
      {evidence !== undefined && <EvidenceDot kind={evidence?.kind ?? null} />}
      {actions}
    </li>
  );
}

/** Who the company is and how to reach it: a larger picture, then one compact row per channel. */
export function IdentityColumn({ lead, detail }: { lead: Lead; detail: CompanyCardDetail }) {
  const t = useT();
  const { company, contact } = lead;
  const mapsUrl = mapsSourceUrl(company);
  const site = safeHref(company.website);
  const phone = company.phone;
  const email = company.email;
  const missing = <span className="muted">{t('common.notFound')}</span>;
  return (
    <div className="lead-identity">
      <div className="lead-picture">
        <CompanyThumb card={detail.card} size={112} />
        <span className="lead-picture-tools">
          <DotLegend />
          <SourcesPopover company={company.evidence} person={contact?.evidence ?? []} />
        </span>
      </div>
      <ul className="lead-rows">
        <Row
          icon={<Phone size={ICON} />}
          label={t('leadView.row.phone')}
          empty={!phone}
          evidence={phone ? evidenceFor(company.evidence, 'phone', phone) : undefined}
          actions={
            phone && (
              <>
                {company.phoneForeign && company.phoneE164 && (
                  <Tip
                    label={t('leadView.info')}
                    text={t('lead.company.phone.foreign', { phone: company.phoneE164 })}
                  >
                    <Info size={14} aria-hidden="true" />
                  </Tip>
                )}
                <WhatsAppButton
                  target={{
                    companyId: company.id,
                    personId: null,
                    company: company.name,
                    sector: company.sector,
                    person: null,
                    phone,
                  }}
                />
                <CopyButton value={phone} what="leadView.what.phone" />
              </>
            )
          }
        >
          {phone
            ? (() => {
                const href = channelHref({ kind: 'phone', value: phone, evidence: null });
                return href ? (
                  <a href={href} aria-label={t('leadView.call', { value: phone })}>
                    {phone}
                  </a>
                ) : (
                  phone
                );
              })()
            : missing}
        </Row>
        <Row
          icon={<Mail size={ICON} />}
          label={t('leadView.row.email')}
          empty={!email}
          evidence={email ? evidenceFor(company.evidence, 'email', email) : undefined}
          actions={email && <CopyButton value={email} what="leadView.what.email" />}
        >
          {email ? (
            <a href={`mailto:${email}`} aria-label={t('leadView.mail', { value: email })}>
              {email}
            </a>
          ) : (
            missing
          )}
        </Row>
        <Row
          icon={<Globe size={ICON} />}
          label={t('leadView.row.website')}
          empty={!site}
          evidence={
            company.website ? evidenceFor(company.evidence, 'website', company.website) : undefined
          }
        >
          {site ? (
            <ExternalLink
              kind="website"
              name={company.name}
              href={site}
              aria-label={t('leadView.open', { value: company.domain ?? site })}
            >
              {company.domain ?? site.replace(/^https?:\/\/(www\.)?/, '')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" className="lead-external" />
            </ExternalLink>
          ) : (
            missing
          )}
        </Row>
        <Row
          icon={<MapPinned size={ICON} />}
          label={t('leadView.row.maps')}
          empty={!(mapsUrl && safeHref(mapsUrl))}
        >
          {mapsUrl && safeHref(mapsUrl) ? (
            <ExternalLink kind="maps" name={company.name} href={safeHref(mapsUrl)!}>
              {t('lead.company.source.maps')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" className="lead-external" />
            </ExternalLink>
          ) : (
            missing
          )}
        </Row>
        <Row icon={<MapPin size={ICON} />} label={t('leadView.row.region')}>
          {company.governorate ? regionLabel(company.governorate) : missing}
        </Row>
      </ul>
    </div>
  );
}
