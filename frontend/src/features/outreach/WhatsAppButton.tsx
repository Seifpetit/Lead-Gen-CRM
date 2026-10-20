import { whatsappNumber } from '@lead-gen-crm/shared';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { WhatsAppPanel } from './WhatsAppPanel.js';
import { targetName, type WhatsAppTarget } from './whatsapp.js';

/**
 * The WhatsApp action for a lead, shown only when its phone looks like a Tunisian mobile
 * (landlines and foreign numbers keep the call link only). It always opens the preview first.
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
        <MessageCircle size={14} aria-hidden="true" />
        {variant === 'button' && t('whatsapp.button')}
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
