import { NumberStepper } from '../../components/shared/NumberStepper.js';
import { parseAmount } from '../../lib/parseAmount.js';
import type { CostGroupBy, CostRow } from '@lead-gen-crm/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Card } from '../../components/shared/Card.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatMonth, formatNumber, formatUsd } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';

const GROUPS: CostGroupBy[] = ['month', 'run', 'region', 'provider'];

/** Spend by month, run, region or provider, and the remaining monthly cap. */
export function CostsWidget({ refreshKey }: { refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const [group, setGroup] = useState<CostGroupBy>('month');
  const costs = useResource(() => api.costs.by(group, { limit: 50 }), {
    deps: [group, refreshKey],
    pollMs: 30_000,
  });
  const budget = useResource(() => api.costs.budget(), { deps: [refreshKey], pollMs: 30_000 });

  return (
    <Card title={t('costs.title')} className="widget-medium">
      <Budget resource={budget} onChanged={() => budget.reload()} />

      <ToggleGroup
        label={t('costs.groupBy')}
        value={group}
        onChange={setGroup}
        options={GROUPS.map((g) => ({ value: g, label: t(`costs.group.${g}` as StringKey) }))}
      />

      {costs.loading && !costs.data ? (
        <LoadingState />
      ) : costs.error !== null && !costs.data ? (
        <ErrorState error={costs.error} onRetry={costs.reload} />
      ) : !costs.data || costs.data.items.length === 0 ? (
        <EmptyState title={t('costs.empty.title')}>{t('costs.empty.body')}</EmptyState>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('costs.col.key')}</th>
                <th scope="col" className="num">
                  {t('costs.col.actual')}
                </th>
                <th scope="col" className="num">
                  {t('costs.col.estimate')}
                </th>
                <th scope="col" className="num">
                  {t('costs.col.total')}
                </th>
                <th scope="col" className="num">
                  {t('costs.col.entries')}
                </th>
              </tr>
            </thead>
            <tbody>
              {costs.data.items.map((row) => (
                <tr key={row.key}>
                  <th scope="row" data-label={t('costs.col.key')}>
                    <RowName group={group} row={row} />
                  </th>
                  <td className="num" data-label={t('costs.col.actual')}>
                    {formatUsd(row.actualUsd)}
                  </td>
                  <td className="num" data-label={t('costs.col.estimate')}>
                    {formatUsd(row.openEstimateUsd)}
                  </td>
                  <td className="num" data-label={t('costs.col.total')}>
                    {formatUsd(row.totalUsd)}
                  </td>
                  <td className="num" data-label={t('costs.col.entries')}>
                    {formatNumber(row.entries)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{t('costs.note')}</p>
        </>
      )}
    </Card>
  );
}

function RowName({ group, row }: { group: CostGroupBy; row: CostRow }) {
  const t = useT();
  if (group === 'month') return <>{formatMonth(row.key)}</>;
  if (group === 'run') {
    return (
      <Link to={`/leadgen/runs/${row.key}`}>{t('costs.run', { id: row.key.slice(0, 8) })}</Link>
    );
  }
  return <>{row.key}</>;
}

function Budget({
  resource,
  onChanged,
}: {
  resource: ReturnType<typeof useResource<import('@lead-gen-crm/shared').BudgetView>>;
  onChanged: () => void;
}) {
  const t = useT();
  const api = useApi();
  const inputId = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const b = resource.data;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cap = parseAmount(text);
    if (cap === null || cap <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.costs.setCap(cap);
      setText('');
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="budget" aria-label={t('costs.budget.title')}>
      <h3>{t('costs.budget.title')}</h3>
      {resource.loading && !b ? (
        <LoadingState />
      ) : resource.error !== null && !b ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : b ? (
        <p>
          {b.capUsd === null
            ? t('costs.budget.none')
            : t('costs.budget.remaining', {
                remaining: formatUsd(b.remainingUsd),
                cap: formatUsd(b.capUsd),
                month: formatMonth(b.month),
              })}
          {b.capUsd !== null && (
            <>
              <br />
              <span className="muted">
                {t('costs.budget.spent', { spent: formatUsd(b.spentUsd) })}
              </span>
            </>
          )}
        </p>
      ) : null}
      <form onSubmit={submit} className="inline-form" noValidate>
        <label htmlFor={inputId}>{t('costs.budget.label')}</label>
        <NumberStepper
          id={inputId}
          prefix="$"
          value={text}
          onChange={setText}
          min={1}
          step={1}
          decimals={2}
          invalid={invalid}
        />
        <button type="submit" className="button" disabled={busy}>
          {busy ? t('costs.budget.saving') : t('costs.budget.save')}
        </button>
      </form>
      {invalid && (
        <p className="form-error" role="alert">
          {t('costs.budget.invalid')}
        </p>
      )}
      {error !== null && (
        <p className="form-error" role="alert">
          {describeError(t, error)}
        </p>
      )}
      {saved && (
        <p className="notice" role="status">
          {t('costs.budget.saved')}
        </p>
      )}
    </section>
  );
}
