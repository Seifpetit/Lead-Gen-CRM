import {
  fillTemplate,
  missingVariables,
  whatsappNumber,
  type MessageTemplate,
  type TemplateValues,
} from '@lead-gen-crm/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { ChipEditor, variableLabel } from '../../components/shared/ChipEditor.js';
import { ExternalOpenPanel } from '../../components/shared/ExternalOpenPanel.js';
import { Select } from '../../components/shared/Select.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { whatsappAppUrl, whatsappWebUrl } from '../../lib/externalOpen.js';
import { useResource } from '../../lib/useResource.js';
import {
  lastTemplate,
  rememberTemplate,
  sectorWording,
  shownNumber,
  targetName,
  type WhatsAppTarget,
} from './whatsapp.js';

const NONE = '';

/**
 * The WhatsApp message preview: who it is for, a template to start from, the message with its
 * variables as chips (editable), and the two ways to open it. Nothing is sent from here; the
 * person sends it in WhatsApp. Opening notes the contact on the card.
 */
export function WhatsAppPanel({
  target,
  onClose,
  onContacted,
}: {
  target: WhatsAppTarget;
  onClose: () => void;
  /** After WhatsApp was opened and the contact noted. */
  onContacted?: (at: string) => void;
}) {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const templateId = useId();
  const messageId = useId();
  const templates = useResource(() => api.templates.list());
  const sender = useResource(() => api.profile.sender());
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const items: MessageTemplate[] = useMemo(() => templates.data?.items ?? [], [templates.data]);
  // Start from the template used last time, or the first one.
  useEffect(() => {
    if (chosen !== null || items.length === 0) return;
    const pick = items.find((x) => x.id === lastTemplate()) ?? items[0]!;
    setChosen(pick.id);
    setMessage(pick.body);
  }, [items, chosen]);

  const values: TemplateValues = useMemo(
    () => ({
      company: target.company,
      sector: sectorWording(target.sector),
      person: target.person,
      my_name: sender.data?.name ?? null,
      my_company: sender.data?.company ?? null,
    }),
    [target, sender.data],
  );
  const digits = whatsappNumber(target.phone) ?? '';
  const text = fillTemplate(message, values).trim();
  const missing = missingVariables(message, values);
  const name = targetName(target);

  const opened = () => {
    toast.show(t('whatsapp.opened', { name }));
    api.contacts
      .record(target.companyId, target.personId)
      .then((r) => onContacted?.(r.at))
      .catch(() => {
        // WhatsApp is already open; a missing note on the card is not worth an error.
      });
  };

  return (
    <ExternalOpenPanel
      title={t('whatsapp.title')}
      href={digits ? whatsappWebUrl(digits, text) : null}
      primaryLabel={missing.length > 0 ? t('whatsapp.openAnyway') : t('whatsapp.open')}
      secondary={{
        label: t('whatsapp.phoneApp'),
        href: digits ? whatsappAppUrl(digits, text) : null,
      }}
      footerNote={t('whatsapp.yourself')}
      onOpened={opened}
      onClose={onClose}
    >
      <dl className="wa-head">
        <dt>{t('whatsapp.to')}</dt>
        <dd dir="auto">
          {target.person ? `${target.person} · ${target.company}` : target.company}
        </dd>
        <dt>{t('whatsapp.number')}</dt>
        <dd dir="ltr">{shownNumber(target)}</dd>
      </dl>
      <div className="wa-field">
        <label htmlFor={templateId}>{t('whatsapp.template')}</label>
        <Select
          id={templateId}
          value={chosen ?? NONE}
          placeholder={templates.loading ? t('common.loading') : t('whatsapp.template.none')}
          onChange={(id) => {
            const pick = items.find((x) => x.id === id);
            if (!pick) return;
            setChosen(pick.id);
            setMessage(pick.body);
            rememberTemplate(pick.id);
          }}
          options={items.map((x) => ({ value: x.id, label: x.name }))}
        />
        <Link className="wa-settings" to="/leadgen/settings" onClick={onClose}>
          {t('whatsapp.settings')}
        </Link>
      </div>
      <div className="wa-field">
        <span id={messageId}>{t('whatsapp.message')}</span>
        <ChipEditor value={message} onChange={setMessage} values={values} labelledBy={messageId} />
      </div>
      {missing.length > 0 && (
        <p className="notice notice-warning" role="alert">
          {t(missing.length === 1 ? 'whatsapp.missing.one' : 'whatsapp.missing.many', {
            names: missing.map((v) => variableLabel(t, v)).join(', '),
          })}
        </p>
      )}
      {missing.length === 0 && text === '' && !templates.loading && (
        <p className="notice" role="status">
          {t('whatsapp.empty')}
        </p>
      )}
    </ExternalOpenPanel>
  );
}
