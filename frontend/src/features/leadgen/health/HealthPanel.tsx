import type { HealthProvider, HealthView } from '@lead-gen-crm/shared';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../../api/context.js';
import { ErrorState, LoadingState } from '../../../components/states.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { formatDateTime } from '../../../lib/format.js';
import { useResource } from '../../../lib/useResource.js';
import './health.css';

const POLL_MS = 15_000;

/**
 * Is everything working? The services the app depends on and whether each answers, the startup
 * checks (keys, database, updates), warnings, and the last 20 errors with how often each came
 * back. Everything shown here is already masked by the server.
 */
export function HealthPanel() {
  const t = useT();
  const api = useApi();
  const health = useResource(() => api.health.get(), { pollMs: POLL_MS });
  const [resetting, setResetting] = useState<HealthProvider | null>(null);
  const [resetError, setResetError] = useState<unknown>(null);

  async function reset(provider: HealthProvider) {
    setResetting(provider);
    setResetError(null);
    try {
      const next = await api.health.resetProvider(provider);
      health.setData(() => next);
    } catch (err) {
      setResetError(err);
    } finally {
      setResetting(null);
    }
  }

  if (health.data === null) {
    return health.error !== null ? (
      <ErrorState error={health.error} onRetry={health.reload} />
    ) : (
      <LoadingState label={t('health.loading')} />
    );
  }
  const view: HealthView = health.data;

  return (
    <div className="health">
      {health.error !== null && (
        <p className="form-error" role="alert">
          {describeError(t, health.error)}
        </p>
      )}
      {resetError !== null && (
        <p className="form-error" role="alert">
          {describeError(t, resetError)}
        </p>
      )}

      <section aria-labelledby="health-services">
        <h2 id="health-services">{t('health.providers')}</h2>
        <ul className="health-list">
          {view.providers.map((p) => {
            const name = t(`health.provider.${p.provider}` as StringKey);
            return (
              <li key={p.provider} className="health-row" data-state={p.state}>
                <span className="health-state">
                  {p.state === 'ok' ? (
                    <CircleCheck size={16} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={16} aria-hidden="true" />
                  )}
                  <strong>{name}</strong>
                  <span className="badge" data-state={p.state}>
                    {t(`health.state.${p.state}` as StringKey)}
                  </span>
                </span>
                {p.state !== 'ok' && (
                  <>
                    <span className="health-reason">
                      {p.reason}{' '}
                      {p.since && (
                        <span className="muted">
                          {t('health.since', { time: formatDateTime(p.since) })}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={resetting !== null}
                      aria-label={t('health.reset.for', { provider: name })}
                      title={t('health.reset.hint')}
                      onClick={() => void reset(p.provider)}
                    >
                      {resetting === p.provider ? t('health.resetting') : t('health.reset')}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="health-checks">
        <h2 id="health-checks">{t('health.checks')}</h2>
        <ul className="health-list">
          {view.checks.map((c) => (
            <li key={c.id} className="health-row" data-state={c.status}>
              <span className="health-state">
                {c.status === 'ok' ? (
                  <CircleCheck size={16} aria-hidden="true" />
                ) : (
                  <TriangleAlert size={16} aria-hidden="true" />
                )}
                <span className="badge" data-state={c.status}>
                  {t(`health.check.${c.status}` as StringKey)}
                </span>
              </span>
              <span className="health-reason">{c.message}</span>
            </li>
          ))}
        </ul>
        {view.pendingMigrations.length > 0 && (
          <div className="health-migrations">
            <h3>{t('health.migrations')}</h3>
            <ul>
              {view.pendingMigrations.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
            <p>{t('health.migrations.how')}</p>
          </div>
        )}
      </section>

      {view.warnings.length > 0 && (
        <section aria-labelledby="health-warnings">
          <h2 id="health-warnings">{t('health.warnings')}</h2>
          <ul className="health-list">
            {view.warnings.map((w) => (
              <li key={w.kind} className="health-row" data-state="warn">
                <span className="health-state">
                  <TriangleAlert size={16} aria-hidden="true" />
                </span>
                <span className="health-reason">{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="health-errors">
        <h2 id="health-errors">{t('health.errors')}</h2>
        {view.errors.length === 0 ? (
          <p className="muted">{t('health.errors.empty')}</p>
        ) : (
          <table className="table health-errors">
            <thead>
              <tr>
                <th scope="col">{t('health.errors.when')}</th>
                <th scope="col">{t('health.errors.where')}</th>
                <th scope="col">{t('health.errors.what')}</th>
                <th scope="col" className="num">
                  {t('health.errors.times')}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.errors.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.lastSeen)}</td>
                  <td>{[e.provider, e.step ?? e.source].filter(Boolean).join(' · ')}</td>
                  <td>
                    {e.message}
                    {e.stack && (
                      <details>
                        <summary>{t('health.errors.detail')}</summary>
                        <pre>{e.stack}</pre>
                      </details>
                    )}
                  </td>
                  <td className="num">
                    {e.count === 1
                      ? t('health.errors.times.one')
                      : t('health.errors.times.value', { count: e.count })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted health-checked">
        {t('health.checked', { time: formatDateTime(view.checkedAt) })}
      </p>
    </div>
  );
}
