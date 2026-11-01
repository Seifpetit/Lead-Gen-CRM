import './costs/costs.css';
import type { BudgetView, CostGroupBy, CostRow } from '@lead-gen-crm/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { NumberStepper } from '../../components/shared/NumberStepper.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatMonth, formatNumber, formatUsd } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import {
  MAX_MONTHLY_CAP_USD,
  MIN_MONTHLY_CAP_USD,
  monthlyCapProblem,
  parseMonthlyCap,
} from './costs/monthlyCap.js';

const GROUPS: CostGroupBy[] = ['month', 'run', 'region', 'provider'];
const POLL_MS = 30_000;

/**
 * Costs is one bordered panel like the Dashboard: a slim header, a one-line strip for this
 * month, the monthly cap and the grouping, then the table, which scrolls inside the panel.
 */
export function CostsPage() {
  const t = useT();
  const api = useApi();
  const [group, setGroup] = useState<CostGroupBy>('month');
  const costs = useResource(() => api.costs.by(group, { limit: 50 }), {
    deps: [group],
    pollMs: POLL_MS,
  });
  const months = useResource(() => api.costs.by('month', { limit: 12 }), { pollMs: POLL_MS });
  const budget = useResource(() => api.costs.budget(), { pollMs: POLL_MS });

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel costs-panel" role="region" aria-label={t('costs.title')}>
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.costs')}</SectionTitle>
        </header>
        <MonthStrip months={months.data?.items ?? null} budget={budget.data ?? null} />
        <div className="costs-toolbar">
          <Budget resource={budget} onChanged={() => budget.reload()} />
          <ToggleGroup
            label={t('costs.groupBy')}
            value={group}
            onChange={setGroup}
            options={GROUPS.map((g) => ({ value: g, label: t(`costs.group.${g}` as StringKey) }))}
          />
        </div>
        <div className="costs-body">
          {costs.loading && !costs.data ? (
            <LoadingState />
          ) : costs.error !== null && !costs.data ? (
            <ErrorState error={costs.error} onRetry={costs.reload} />
          ) : !costs.data || costs.data.items.length === 0 ? (
            <EmptyState title={t('costs.empty.title')}>{t('costs.empty.body')}</EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('costs.col.key')}</th>
                  <th scope="col">{t('country.column')}</th>
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
                    <td data-label={t('country.column')}>{row.country ?? '–'}</td>
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
          )}
        </div>
        <p className="costs-note muted small">{t('costs.note')}</p>
      </div>
    </main>
  );
}

/** "This month: $1.93 actual, $0.00 pending, cap not set". */
function MonthStrip({ months, budget }: { months: CostRow[] | null; budget: BudgetView | null }) {
  const t = useT();
  if (months === null || budget === null) return null;
  const row = months.find((m) => m.key === budget.month.slice(0, 7));
  const cap =
    budget.capUsd === null
      ? t('costs.strip.noCap')
      : t('costs.strip.cap', { cap: formatUsd(budget.capUsd) });
  return (
    <p className="costs-strip" role="status">
      {t('costs.strip', {
        actual: formatUsd(row?.actualUsd ?? 0),
        pending: formatUsd(row?.openEstimateUsd ?? 0),
        cap,
      })}
    </p>
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
  resource: ReturnType<typeof useResource<BudgetView>>;
  onChanged: () => void;
}) {
  const t = useT();
  const api = useApi();
  const inputId = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<ReturnType<typeof monthlyCapProblem>>(null);
  const [saved, setSaved] = useState(false);
  const b = resource.data;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const found = monthlyCapProblem(text);
    setProblem(found);
    const cap = parseMonthlyCap(text);
    if (found !== null || cap === null) return;
    setBusy(true);
    setError(null);
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

  const message =
    problem === 'low'
      ? t('costs.budget.low', { min: formatUsd(MIN_MONTHLY_CAP_USD) })
      : problem === 'high'
        ? t('costs.budget.high', { max: formatUsd(MAX_MONTHLY_CAP_USD) })
        : problem === 'cents'
          ? t('costs.budget.cents')
          : problem === 'invalid'
            ? t('costs.budget.invalid')
            : null;

  return (
    <section className="budget" aria-label={t('costs.budget.title')}>
      <form onSubmit={submit} className="inline-form" noValidate>
        <label htmlFor={inputId}>{t('costs.budget.label')}</label>
        <NumberStepper
          id={inputId}
          prefix="$"
          value={text}
          onChange={(v) => {
            setText(v);
            setProblem(null);
          }}
          min={MIN_MONTHLY_CAP_USD}
          max={MAX_MONTHLY_CAP_USD}
          step={1}
          decimals={2}
          invalid={problem !== null}
        />
        <button type="submit" className="button" disabled={busy}>
          {busy ? t('costs.budget.saving') : t('costs.budget.save')}
        </button>
      </form>
      <div className="muted small budget-line">
        {resource.loading && !b ? (
          <LoadingState />
        ) : resource.error !== null && !b ? (
          <ErrorState error={resource.error} onRetry={resource.reload} />
        ) : b && b.capUsd !== null ? (
          t('costs.budget.remaining', {
            remaining: formatUsd(b.remainingUsd),
            cap: formatUsd(b.capUsd),
            month: formatMonth(b.month),
          })
        ) : b ? (
          t('costs.budget.none')
        ) : null}
      </div>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
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
