import { whatsappNumber } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { WhatsAppLogo } from '../../components/shared/WhatsAppLogo.js';
import { useT } from '../../i18n/index.js';
import { WhatsAppPanel } from './WhatsAppPanel.js';
import { targetName, type WhatsAppTarget } from './whatsapp.js';

/**
 * The WhatsApp action for a lead, shown only when its phone looks like a Tunisian mobile
 * (landlines and foreign numbers keep the call link only). It always opens the preview first.
 * On a computer, where a phone number cannot be called, it is a labelled "Chat" button with the
 * WhatsApp logo; on a phone the number stays a call link and this shrinks to the logo.
 */
export function WhatsAppButton({
  target,
  variant = 'icon',
  onContacted,
}: {
  target: WhatsAppTarget;
  /** A small icon in a card's channel row, or a labelled button on a page. */
  variant?: 'icon' | 'button';
  onContacted?: (at: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!whatsappNumber(target.phone)) return null;
  const label = t('whatsapp.button.label', { name: targetName(target) });
  return (
    <>
      <button
        type="button"
        className={
          variant === 'icon' ? 'channel channel-whatsapp channel-button' : 'button wa-button'
        }
        aria-label={label}
        title={label}
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <WhatsAppLogo size={variant === 'button' ? 20 : 18} />
        {/* On a computer the button says what it does; on a phone the logo alone is enough. */}
        <span className="wa-label">
          {t(variant === 'button' ? 'whatsapp.button' : 'whatsapp.chat')}
        </span>
      </button>
      {open && (
        <WhatsAppPanel
          target={target}
          onClose={() => setOpen(false)}
          {...(onContacted ? { onContacted } : {})}
        />
      )}
    </>
  );
}
