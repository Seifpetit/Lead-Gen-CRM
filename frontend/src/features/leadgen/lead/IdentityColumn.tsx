import type { CompanyCardDetail, Evidence, Lead } from '@lead-gen-crm/shared';
import {
  Copy,
  Globe,
  Info,
  Mail,
  MapPin,
  MapPinned,
  Phone,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useToast } from '../../../components/shared/Toast.js';
import { Tip } from '../../../components/shared/Tip.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { evidenceFor, safeHref } from '../../../lib/format.js';
import { channelHref, mapsSourceUrl } from '../../../lib/lead.js';
import { CompanyThumb } from '../../crm/BoardCard.js';
import { EvidenceDot } from './EvidenceDot.js';
import { SourcesPopover } from './SourcesPopover.js';

const ICON = 16;

function Row({
  icon,
  label,
  evidence,
  actions,
  children,
}: {
  icon: ReactNode;
  label: string;
  /** Left out for a value with no source to point at. */
  evidence?: Evidence | null | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="lead-row">
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

function CopyButton({ value, what }: { value: string; what: StringKey }) {
  const t = useT();
  const toast = useToast();
  const name = t(what);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(t('leadView.copied', { what: name }));
    } catch {
      toast.show(t('leadView.copyFailed'), 'error');
    }
  };
  const label = t('leadView.copy', { what: name });
  return (
    <button
      type="button"
      className="button button-icon button-small"
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      <Copy size={14} aria-hidden="true" />
    </button>
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
        <SourcesPopover company={company.evidence} person={contact?.evidence ?? []} />
      </div>
      <ul className="lead-rows">
        <Row
          icon={<Phone size={ICON} />}
          label={t('leadView.row.phone')}
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
          evidence={
            company.website ? evidenceFor(company.evidence, 'website', company.website) : undefined
          }
        >
          {site ? (
            <a
              href={site}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('leadView.open', { value: company.domain ?? site })}
            >
              {company.domain ?? site.replace(/^https?:\/\/(www\.)?/, '')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" className="lead-external" />
            </a>
          ) : (
            missing
          )}
        </Row>
        <Row icon={<MapPinned size={ICON} />} label={t('leadView.row.maps')}>
          {mapsUrl && safeHref(mapsUrl) ? (
            <a href={safeHref(mapsUrl) ?? undefined} target="_blank" rel="noreferrer noopener">
              {t('lead.company.source.maps')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" className="lead-external" />
            </a>
          ) : (
            missing
          )}
        </Row>
        <Row icon={<MapPin size={ICON} />} label={t('leadView.row.region')}>
          {company.governorate || missing}
        </Row>
      </ul>
    </div>
  );
}
