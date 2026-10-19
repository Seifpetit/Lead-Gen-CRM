import type { AddDecisionMakerResult, CrmCard, DecisionMakerInput } from '@lead-gen-crm/shared';
import { useId, useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { BOARD_ERRORS } from './useBoard.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function linkedinProblem(value: string): boolean {
  try {
    const url = new URL(value);
    return !(
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      /(^|\.)linkedin\.com$/i.test(url.hostname)
    );
  } catch {
    return true;
  }
}

/**
 * Names the decision-maker of a company. Dropping a card into the last column opens this; the
 * company only moves when it is saved (a name and at least one way to reach them), and
 * cancelling puts the card back.
 */
export function AddDecisionMakerModal({
  card,
  onCancel,
  onSaved,
}: {
  card: CrmCard;
  onCancel: () => void;
  onSaved: (result: AddDecisionMakerResult) => void;
}) {
  const t = useT();
  const api = useApi();
  const ids = { name: useId(), job: useId(), email: useId(), phone: useId(), linkedin: useId() };
  const [values, setValues] = useState({
    fullName: '',
    title: '',
    email: '',
    phone: '',
    linkedinUrl: '',
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const v = {
    fullName: values.fullName.trim(),
    title: values.title.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    linkedinUrl: values.linkedinUrl.trim(),
  };
  const problems = {
    name: !v.fullName,
    email: v.email !== '' && !EMAIL.test(v.email),
    linkedin: v.linkedinUrl !== '' && linkedinProblem(v.linkedinUrl),
    channel: !v.email && !v.phone && !v.linkedinUrl,
  };
  const invalid = problems.name || problems.email || problems.linkedin || problems.channel;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setFailure(null);
    const input: DecisionMakerInput = { fullName: v.fullName };
    if (v.title) input.title = v.title;
    if (v.email) input.email = v.email;
    if (v.phone) input.phone = v.phone;
    if (v.linkedinUrl) input.linkedinUrl = v.linkedinUrl;
    try {
      onSaved(await api.crm.addDecisionMaker(card.id, input));
    } catch (err) {
      setFailure(describeError(t, err, BOARD_ERRORS));
      setBusy(false);
    }
  }

  const show = (bad: boolean) => touched && bad;
  return (
    <Modal
      title={t('crm.dm.title', { company: card.company.name })}
      onClose={() => !busy && onCancel()}
      wide
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="modal-body">
          <p className="muted">{t('crm.dm.intro')}</p>
          <div className="form-field">
            <label htmlFor={ids.name}>{t('crm.dm.name')}</label>
            <input
              id={ids.name}
              value={values.fullName}
              onChange={set('fullName')}
              maxLength={200}
              autoComplete="off"
              aria-invalid={show(problems.name)}
              aria-describedby={show(problems.name) ? `${ids.name}-error` : undefined}
              data-autofocus
            />
            {show(problems.name) && (
              <small id={`${ids.name}-error`} className="form-error">
                {t('crm.dm.name.required')}
              </small>
            )}
          </div>
          <div className="form-field">
            <label htmlFor={ids.job}>{t('crm.dm.jobTitle')}</label>
            <input
              id={ids.job}
              value={values.title}
              onChange={set('title')}
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label htmlFor={ids.email}>{t('crm.dm.email')}</label>
            <input
              id={ids.email}
              type="email"
              value={values.email}
              onChange={set('email')}
              maxLength={200}
              autoComplete="off"
              aria-invalid={show(problems.email)}
              aria-describedby={show(problems.email) ? `${ids.email}-error` : undefined}
            />
            {show(problems.email) && (
              <small id={`${ids.email}-error`} className="form-error">
                {t('crm.dm.email.invalid')}
              </small>
            )}
          </div>
          <div className="form-field">
            <label htmlFor={ids.phone}>{t('crm.dm.phone')}</label>
            <input
              id={ids.phone}
              type="tel"
              value={values.phone}
              onChange={set('phone')}
              maxLength={40}
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label htmlFor={ids.linkedin}>{t('crm.dm.linkedin')}</label>
            <input
              id={ids.linkedin}
              type="url"
              value={values.linkedinUrl}
              onChange={set('linkedinUrl')}
              maxLength={300}
              autoComplete="off"
              aria-invalid={show(problems.linkedin)}
              aria-describedby={`${ids.linkedin}-help${show(problems.linkedin) ? ` ${ids.linkedin}-error` : ''}`}
            />
            <small id={`${ids.linkedin}-help`} className="muted">
              {t('crm.dm.linkedin.help')}
            </small>
            {show(problems.linkedin) && (
              <small id={`${ids.linkedin}-error`} className="form-error">
                {t('crm.dm.linkedin.invalid')}
              </small>
            )}
          </div>
          {show(problems.channel && !problems.name) && (
            <p className="form-error" role="alert">
              {t('crm.dm.channel.required')}
            </p>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? t('crm.dm.saving') : t('crm.dm.save')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
