import type { CrmCard } from '@lead-gen-crm/shared';
import { formatPhone, regionLabel } from '@lead-gen-crm/shared';
import { Globe, Mail, Phone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ExternalLink } from '../../components/shared/ExternalLink.js';
import { useT, type Translate } from '../../i18n/index.js';
import { formatDay, hostOf, safeHref } from '../../lib/format.js';
import { WhatsAppButton } from '../outreach/WhatsAppButton.js';
import { targetOfCard } from '../outreach/whatsapp.js';
import { cardName } from './useBoard.js';

const ICON = 14;

/** The LinkedIn mark; the icon set has no brand logos. */
export function LinkedinIcon() {
  return (
    <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

/** "Sfax · Corporate office": the city and Google's own category, whichever we have. */
export function cardSubtitle(card: CrmCard): string {
  const { company } = card;
  const place = company.city ?? regionLabel(company.regionId);
  return [place, company.category].filter(Boolean).join(' · ');
}

/** Everything the subtitle leaves out, for the tooltip: sector, when it was found, the stage. */
export function cardTooltip(card: CrmCard, t: Translate, sectorName: string | null): string {
  return [cardSubtitle(card), sectorName, t('crm.card.found', { date: formatDay(card.foundAt) })]
    .filter(Boolean)
    .join(' · ');
}

/** "Score 38", read the same way by a screen reader. */
export function ScoreBadge({ score }: { score: number }) {
  const t = useT();
  const text = t('crm.card.score', { total: score });
  return (
    <span className="badge badge-score" title={text}>
      {text}
    </span>
  );
}

/** "Exportateur", "Importateur", "Les deux" or "Négociant"; nothing for the other labels. */
export function TradeBadge({ role }: { role: CrmCard['company']['tradeRole'] }) {
  const t = useT();
  if (role !== 'exporter' && role !== 'importer' && role !== 'both' && role !== 'trader') {
    return null;
  }
  return <span className="badge badge-trade">{t(`trade.role.${role}`)}</span>;
}

/** The domain of an email address ("amel@acme.example" shows "acme.example"). */
export const emailDomain = (email: string): string => email.split('@').pop() ?? email;

/** A website's host without "www.". */
export const siteDomain = (url: string): string => hostOf(url).replace(/^www\./, '');

function Missing({
  icon,
  label,
  className,
}: {
  icon: ReactNode;
  label: string;
  className: string;
}) {
  return (
    <span className={`channel is-missing ${className}`} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}

/**
 * How to reach a card: the phone in full in a slot of its own, the email and website as their
 * domains (the whole value in a tooltip). A channel we do not have is a greyed icon that says so.
 */
export function ChannelRows({
  card,
  trailing,
}: {
  card: CrmCard;
  /** Shown at the right end of the phone row (a card's move and remove buttons). */
  trailing?: ReactNode;
}) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
  const phone = person ? person.phone : company.phone;
  const email = person ? person.email : company.email;
  const site = !person && company.website ? safeHref(company.website) : null;
  const linkedin = person?.linkedinUrl ? safeHref(person.linkedinUrl) : null;
  const shown = formatPhone(phone);
  const [contactedAt, setContactedAt] = useState<string | null>(null);
  const lastContact = contactedAt ?? card.lastContactAt ?? null;

  return (
    <span className="channels">
      <span className="channel-row channel-row-phone">
        {shown ? (
          <a
            className="channel channel-phone"
            href={`tel:${(phone ?? '').replace(/[^\d+]/g, '')}`}
            draggable={false}
            aria-label={t('crm.card.phone', { value: shown })}
            title={t('crm.card.phone', { value: shown })}
          >
            <Phone size={ICON} aria-hidden="true" />
            <span className="channel-text channel-number">{shown}</span>
          </a>
        ) : (
          <Missing
            icon={<Phone size={ICON} aria-hidden="true" />}
            label={t('leads.noPhone')}
            className="channel-phone"
          />
        )}
        <WhatsAppButton target={targetOfCard(card)} onContacted={setContactedAt} />
        {trailing}
      </span>
      <span className="channel-row">
        {email ? (
          <a
            className="channel channel-email"
            href={`mailto:${email}`}
            draggable={false}
            aria-label={t('crm.card.email', { value: email })}
            title={email}
          >
            <Mail size={ICON} aria-hidden="true" />
            <span className="channel-text">{emailDomain(email)}</span>
          </a>
        ) : (
          <Missing
            icon={<Mail size={ICON} aria-hidden="true" />}
            label={t('leads.noEmail')}
            className="channel-email"
          />
        )}
        {!person &&
          (site ? (
            <ExternalLink
              kind="website"
              name={company.name}
              className="channel channel-site"
              href={site}
              draggable={false}
              aria-label={t('crm.card.website', { name })}
              title={company.website ?? site}
            >
              <Globe size={ICON} aria-hidden="true" />
              <span className="channel-text">{siteDomain(site)}</span>
            </ExternalLink>
          ) : (
            <Missing
              icon={<Globe size={ICON} aria-hidden="true" />}
              label={t('leads.noWebsite')}
              className="channel-site"
            />
          ))}
        {linkedin && (
          <ExternalLink
            kind="linkedin"
            name={name}
            className="channel channel-linkedin"
            href={linkedin}
            draggable={false}
            aria-label={t('crm.card.linkedin', { name })}
            title={t('crm.card.linkedin', { name })}
          >
            <LinkedinIcon />
          </ExternalLink>
        )}
      </span>
      {lastContact && (
        <span className="contact-line">
          {t('whatsapp.lastContact', { date: formatDay(lastContact) })}
        </span>
      )}
    </span>
  );
}
