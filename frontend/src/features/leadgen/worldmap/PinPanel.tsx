import { formatPhone, type MapPin } from '@lead-gen-crm/shared';
import { ArrowRight, Globe, Phone, X } from 'lucide-react';
import { Link } from 'react-router';
import { ExternalLink } from '../../../components/shared/ExternalLink.js';
import { useT } from '../../../i18n/index.js';
import { hostOf, safeHref } from '../../../lib/format.js';
import { ScoreBadge, TradeBadge } from '../../crm/cardParts.js';

const WIDTH = 288;
const EDGE = 12;
/** Room the panel needs above the pin; when there is less, it opens below. */
const ROOM_ABOVE = 250;

/**
 * The small panel that pops up over a pin: who the company is, how it scored, and a button to
 * its lead page. It sits on the pin, stays inside the map, and opens below the pin when the pin
 * is near the top. A short overshoot makes it spring open.
 */
export function PinPanel({
  pin,
  at,
  size,
  regionName,
  onClose,
}: {
  pin: MapPin;
  /** Where the pin is on the map, in pixels from its top left corner. */
  at: { x: number; y: number };
  size: { width: number; height: number };
  /** Shown when the company has no city of its own. */
  regionName: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const left = Math.min(
    Math.max(at.x, WIDTH / 2 + EDGE),
    Math.max(size.width - WIDTH / 2 - EDGE, WIDTH / 2 + EDGE),
  );
  const below = at.y < ROOM_ABOVE;
  // The little pointer under the panel points at the pin, but never off the panel's edge.
  const arrow = Math.min(Math.max(at.x - left + WIDTH / 2, 24), WIDTH - 24);
  const href = safeHref(pin.website);
  const phone = formatPhone(pin.phone);
  const place = [pin.city ?? regionName, pin.category].filter(Boolean).join(' · ');
  const leadPath =
    pin.runId && pin.leadId ? `/leadgen/runs/${pin.runId}/leads/${pin.leadId}` : null;

  return (
    <section
      className={`wm-pin-panel${below ? ' is-below' : ''}`}
      style={{
        left,
        top: at.y,
        width: WIDTH,
        ['--wm-arrow' as string]: `${arrow}px`,
      }}
      aria-label={t('wm.pin.label', { name: pin.name })}
    >
      <button
        type="button"
        className="wm-pin-close"
        aria-label={t('wm.pin.close')}
        title={t('wm.pin.close')}
        onClick={onClose}
      >
        <X size={14} aria-hidden="true" />
      </button>
      <h2 className="wm-pin-name">{pin.name}</h2>
      {place && <p className="wm-pin-place">{place}</p>}
      <div className="wm-pin-badges">
        <TradeBadge role={pin.tradeRole} />
        {pin.score !== null && <ScoreBadge score={pin.score} />}
      </div>
      <ul className="wm-pin-facts">
        {phone && (
          <li>
            <Phone size={14} aria-hidden="true" />
            <span>{phone}</span>
          </li>
        )}
        {href && (
          <li>
            <Globe size={14} aria-hidden="true" />
            <ExternalLink href={href} kind="website" name={pin.name}>
              {hostOf(href).replace(/^www\./, '')}
            </ExternalLink>
          </li>
        )}
      </ul>
      {leadPath ? (
        <Link to={leadPath} className="button button-primary wm-pin-open">
          {t('wm.pin.open')}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : (
        <p className="wm-pin-note">{t('wm.pin.noLead')}</p>
      )}
    </section>
  );
}
