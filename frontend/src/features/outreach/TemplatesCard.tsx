import {
  MAX_SENDER_FIELD_LENGTH,
  MAX_TEMPLATE_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  TEMPLATE_LANGUAGES,
  type MessageTemplate,
  type TemplateLanguage,
} from '@lead-gen-crm/shared';
import { Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useApi } from '../../api/context.js';
import { Card } from '../../components/shared/Card.js';
import { ChipEditor } from '../../components/shared/ChipEditor.js';
import { useToast } from '../../components/shared/Toast.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { useResource } from '../../lib/useResource.js';

const NEW = 'new';
const TEMPLATE_ERRORS = { too_many_templates: 'templates.error.too_many_templates' } as const;

/** Settings: the user's message templates, each a name and a French (or Arabic) text with chips. */
export function TemplatesCard() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const nameId = useId();
  const textId = useId();
  const hintId = useId();
  const list = useResource(() => api.templates.list());
  const items: MessageTemplate[] = list.data?.items ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [language, setLanguage] = useState<TemplateLanguage>('fr');
  const languageId = useId();
  const [busy, setBusy] = useState(false);

  const current = items.find((x) => x.id === selected) ?? null;
  const pick = (template: MessageTemplate | null) => {
    setSelected(template?.id ?? NEW);
    setName(template?.name ?? t('templates.newName'));
    setBody(template?.body ?? '');
    setLanguage(template?.language ?? 'fr');
  };
  // Open the first template once the list arrives.
  useEffect(() => {
    if (selected === null && list.data) {
      const first = list.data.items[0];
      if (first) pick(first);
    }
  }, [list.data, selected]);

  const dirty =
    selected === NEW ||
    (current !== null &&
      (current.name !== name || current.body !== body || current.language !== language));
  const valid =
    name.trim() !== '' &&
    name.length <= MAX_TEMPLATE_NAME_LENGTH &&
    body.trim() !== '' &&
    body.length <= MAX_TEMPLATE_LENGTH;

  const save = async () => {
    setBusy(true);
    try {
      const input = { name: name.trim(), body, language };
      const saved =
        selected === NEW || !current
          ? await api.templates.create(input)
          : await api.templates.update(current.id, input);
      list.setData((d) => {
        const all = d?.items ?? [];
        const exists = all.some((x) => x.id === saved.id);
        return {
          items: exists ? all.map((x) => (x.id === saved.id ? saved : x)) : [...all, saved],
        };
      });
      pick(saved);
      toast.show(t('templates.saved'));
    } catch (err) {
      toast.show(describeError(t, err, TEMPLATE_ERRORS), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) {
      pick(items[0] ?? null);
      return;
    }
    setBusy(true);
    try {
      await api.templates.remove(current.id);
      const rest = items.filter((x) => x.id !== current.id);
      list.setData(() => ({ items: rest }));
      if (rest[0]) pick(rest[0]);
      else {
        setSelected(null);
        setName('');
        setBody('');
      }
      toast.show(t('templates.deleted'));
    } catch (err) {
      toast.show(describeError(t, err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('templates.title')} className="info-card widget-wide">
      <p className="muted">{t('templates.intro')}</p>
      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error !== null && !list.data ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <div className="templates">
          <ul className="templates-list" aria-label={t('templates.list')}>
            {items.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className="button"
                  aria-current={x.id === selected ? 'true' : undefined}
                  onClick={() => pick(x)}
                  dir="auto"
                >
                  {x.name}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="button button-icon-text"
                aria-current={selected === NEW ? 'true' : undefined}
                onClick={() => pick(null)}
              >
                <Plus size={14} aria-hidden="true" />
                {t('templates.new')}
              </button>
            </li>
          </ul>
          {selected === null ? (
            <p className="muted">{t('templates.empty')}</p>
          ) : (
            <form
              className="templates-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && dirty) void save();
              }}
            >
              <label htmlFor={nameId}>{t('templates.name')}</label>
              <input
                id={nameId}
                type="text"
                value={name}
                maxLength={MAX_TEMPLATE_NAME_LENGTH}
                dir="auto"
                onChange={(e) => setName(e.target.value)}
              />
              <label htmlFor={languageId}>{t('templates.language')}</label>
              <select
                id={languageId}
                value={language}
                onChange={(e) => setLanguage(e.target.value as TemplateLanguage)}
              >
                {TEMPLATE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`templates.language.${l}`)}
                  </option>
                ))}
              </select>
              <span id={textId}>{t('templates.text')}</span>
              <ChipEditor
                value={body}
                onChange={setBody}
                labelledBy={textId}
                describedBy={hintId}
                maxLength={MAX_TEMPLATE_LENGTH}
                rows={8}
              />
              <p id={hintId} className="muted small">
                {dirty ? t('templates.unsaved') : ''}
              </p>
              <div className="templates-actions">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t('templates.delete')}
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || !valid || !dirty}
                >
                  {t('templates.save')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

/** Settings: who the messages come from, for {my_name} and {my_company}. */
export function SenderCard() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const nameId = useId();
  const companyId = useId();
  const sender = useResource(() => api.profile.sender());
  const [name, setName] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownName = name ?? sender.data?.name ?? '';
  const shownCompany = company ?? sender.data?.company ?? '';

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.profile.setSender({ name: shownName, company: shownCompany });
      sender.setData(() => saved);
      setName(null);
      setCompany(null);
      toast.show(t('sender.saved'));
    } catch (err) {
      toast.show(describeError(t, err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('sender.title')} className="info-card">
      <p className="muted">{t('sender.intro')}</p>
      <form
        className="sender-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={nameId}>{t('sender.name')}</label>
        <input
          id={nameId}
          type="text"
          dir="auto"
          value={shownName}
          maxLength={MAX_SENDER_FIELD_LENGTH}
          disabled={sender.loading && !sender.data}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor={companyId}>{t('sender.company')}</label>
        <input
          id={companyId}
          type="text"
          dir="auto"
          value={shownCompany}
          maxLength={MAX_SENDER_FIELD_LENGTH}
          disabled={sender.loading && !sender.data}
          onChange={(e) => setCompany(e.target.value)}
        />
        <div>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || (name === null && company === null)}
          >
            {t('sender.save')}
          </button>
        </div>
      </form>
    </Card>
  );
}
