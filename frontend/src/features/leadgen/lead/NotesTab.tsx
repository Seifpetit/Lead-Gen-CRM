import { MAX_NOTES_LENGTH, type CardEvent } from '@lead-gen-crm/shared';
import { useId, useState } from 'react';
import { useApi } from '../../../api/context.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { formatDateTime } from '../../../lib/format.js';

/** Free-text notes saved per company, and the read-only list of the stages it has been in. */
export function NotesTab({
  companyId,
  saved,
  draft,
  onDraft,
  onSaved,
  history,
}: {
  companyId: string;
  /** The text the server holds. */
  saved: string;
  /** What is typed; kept by the page so switching tabs does not lose it. */
  draft: string;
  onDraft: (text: string) => void;
  onSaved: (text: string) => void;
  history: readonly CardEvent[];
}) {
  const t = useT();
  const api = useApi();
  const id = useId();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { failed: string }>('idle');
  const dirty = draft !== saved;
  const stage = (key: CardEvent['to']) => t(`boardStage.${key}`);

  const save = async () => {
    setState('saving');
    try {
      const result = await api.crm.saveNotes(companyId, draft);
      onSaved(result.notes);
      setState('saved');
    } catch (err) {
      setState({ failed: describeError(t, err) });
    }
  };

  return (
    <div className="lead-notes">
      <label htmlFor={id}>{t('leadView.notes.label')}</label>
      <textarea
        id={id}
        rows={6}
        maxLength={MAX_NOTES_LENGTH}
        value={draft}
        onChange={(e) => {
          onDraft(e.target.value);
          setState('idle');
        }}
      />
      <div className="notes-bar">
        <span className="muted small">
          {t('leadView.notes.hint', { count: draft.length, max: MAX_NOTES_LENGTH })}
        </span>
        <span role="status" className="small">
          {state === 'saving' && t('leadView.notes.saving')}
          {state === 'saved' && !dirty && t('leadView.notes.saved')}
        </span>
        <button
          type="button"
          className="button button-primary"
          disabled={!dirty || state === 'saving'}
          onClick={() => void save()}
        >
          {t('leadView.notes.save')}
        </button>
      </div>
      {typeof state === 'object' && (
        <p className="form-error" role="alert">
          {t('leadView.notes.failed', { reason: state.failed })}
        </p>
      )}

      <h3>{t('leadView.history')}</h3>
      {history.length === 0 ? (
        <p className="muted">{t('leadView.history.none')}</p>
      ) : (
        <ol className="history">
          {history.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span>
                {e.from === null
                  ? t('leadView.history.created', { stage: stage(e.to) })
                  : t('leadView.history.moved', { from: stage(e.from), to: stage(e.to) })}
              </span>
              <time dateTime={e.at} className="muted">
                {formatDateTime(e.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
