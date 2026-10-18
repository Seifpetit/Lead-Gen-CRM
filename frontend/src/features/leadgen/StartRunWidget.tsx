import type { RegionSummary, RunPreview, RunSummary } from '@lead-gen-crm/shared';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { KindTag } from '../../components/Evidence.js';
import { Modal } from '../../components/Modal.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { Widget } from '../../components/Widget.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatNumber, formatPercent, formatUsd } from '../../lib/format.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useResource } from '../../lib/useResource.js';
import type { StartPrefill } from './prefill.js';

export const PREVIEW_DEBOUNCE_MS = 350;

/** Mirrors the server's limits on typed-in wordings. */
export const MAX_CUSTOM_WORDINGS = 20;
export const MAX_WORDING_CHARS = 80;

/** One wording per line; blank lines and repeated spaces are ignored. */
export function parseWordings(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

function wordingsProblem(wordings: string[]): 'tooMany' | 'tooLong' | null {
  if (wordings.length > MAX_CUSTOM_WORDINGS) return 'tooMany';
  if (wordings.some((w) => w.length > MAX_WORDING_CHARS)) return 'tooLong';
  return null;
}

function parseCap(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Region first: coverage, the scheduler's suggestion, an estimate, a required cap, a confirm. */
export function StartRunWidget({
  onStarted,
  prefill,
}: {
  onStarted: () => void;
  /** Set by the coverage widgets; each new object (a fresh click) is applied once. */
  prefill?: (StartPrefill & { nonce: number }) | null;
}) {
  const t = useT();
  const api = useApi();
  const regionId = useId();
  const capId = useId();
  const capHelpId = useId();
  const [region, setRegion] = useState('');
  const [capText, setCapText] = useState('');
  const [capTouched, setCapTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [started, setStarted] = useState<RunSummary | null>(null);
  // The search plan. null sectors = all of them; cells empty = the scheduler chooses.
  const [sectorIds, setSectorIds] = useState<string[] | null>(null);
  const [wordingsText, setWordingsText] = useState('');
  const [cellKeys, setCellKeys] = useState<string[]>([]);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setRegion(prefill.regionId);
    setSectorIds(prefill.sectorIds ?? null);
    setCellKeys(prefill.cellKeys ?? []);
    setStarted(null);
    setPrefilled(true);
  }, [prefill]);

  const regions = useResource(() => api.regions.list({ limit: 100 }));
  const suggestion = useResource(() => api.regions.suggestion());

  const cap = parseCap(capText);
  const wordings = useMemo(() => parseWordings(wordingsText), [wordingsText]);
  const problem = wordingsProblem(wordings);
  const emptyPlan = sectorIds !== null && sectorIds.length === 0 && wordings.length === 0;
  const planKey = JSON.stringify([sectorIds, wordings, cellKeys]);
  const debouncedRegion = useDebounced(region, PREVIEW_DEBOUNCE_MS);
  const debouncedCap = useDebounced(cap, PREVIEW_DEBOUNCE_MS);
  const debouncedPlan = useDebounced(planKey, PREVIEW_DEBOUNCE_MS);
  const settled = debouncedRegion === region && debouncedCap === cap && debouncedPlan === planKey;
  const planValid = problem === null && !emptyPlan;
  const preview = useResource<RunPreview>(
    () => {
      const [ids, words, cells] = JSON.parse(debouncedPlan) as [
        string[] | null,
        string[],
        string[],
      ];
      return api.runs.preview({
        regionId: debouncedRegion,
        ...(ids !== null ? { sectorIds: ids } : {}),
        ...(words.length > 0 ? { customWordings: words } : {}),
        ...(cells.length > 0 ? { cellKeys: cells } : {}),
        ...(debouncedCap !== null ? { budgetCapUsd: debouncedCap } : {}),
      });
    },
    {
      enabled: debouncedRegion !== '' && planValid,
      deps: [debouncedRegion, debouncedCap, debouncedPlan],
    },
  );

  const selected: RegionSummary | undefined = regions.data?.items.find(
    (r) => r.regionId === region,
  );
  const blockers = preview.data?.blockers ?? [];
  const previewReady =
    region !== '' && settled && planValid && preview.data !== null && !preview.error;
  const canReview = cap !== null && previewReady && blockers.length === 0 && !preview.loading;

  function review(event: FormEvent) {
    event.preventDefault();
    setCapTouched(true);
    if (canReview) {
      setStartError(null);
      setConfirming(true);
    }
  }

  async function start() {
    if (cap === null) return;
    setStarting(true);
    setStartError(null);
    try {
      // The only call that starts a run: it needs the confirm made in the dialog and a cap.
      const run = await api.runs.start({
        regionId: region,
        ...(sectorIds !== null ? { sectorIds } : {}),
        ...(wordings.length > 0 ? { customWordings: wordings } : {}),
        ...(cellKeys.length > 0 ? { cellKeys } : {}),
        budgetCapUsd: cap,
        confirm: true,
      });
      setStarted(run);
      setConfirming(false);
      onStarted();
      preview.reload();
    } catch (err) {
      setStartError(err);
    } finally {
      setStarting(false);
    }
  }

  const regionName = selected?.name ?? region;
  const sugg = suggestion.data;
  const suggestedRegion = sugg?.regionId
    ? regions.data?.items.find((r) => r.regionId === sugg.regionId)
    : undefined;

  return (
    <Widget title={t('start.title')} className="widget-medium" anchor="start-run">
      <section aria-live="polite" className="suggestion">
        <h3>{t('start.suggestion.title')}</h3>
        {suggestion.loading && !sugg ? (
          <LoadingState label={t('start.suggestion.loading')} />
        ) : suggestion.error && !sugg ? (
          <ErrorState error={suggestion.error} onRetry={suggestion.reload} />
        ) : sugg?.regionId ? (
          <>
            <p>
              <strong>{suggestedRegion?.name ?? sugg.regionId}</strong>
              {' — '}
              {sugg.reason}
            </p>
            <button
              type="button"
              className="button"
              onClick={() => setRegion(sugg.regionId!)}
              disabled={region === sugg.regionId}
            >
              {t('start.suggestion.use', { region: suggestedRegion?.name ?? sugg.regionId })}
            </button>
          </>
        ) : (
          <p className="muted">
            {t('start.suggestion.none')} {sugg?.reason}
          </p>
        )}
      </section>

      <form onSubmit={review} noValidate>
        <div className="form-field">
          <label htmlFor={regionId}>{t('start.region')}</label>
          <select
            id={regionId}
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setCellKeys([]);
              setPrefilled(false);
              setStarted(null);
            }}
            disabled={regions.loading && !regions.data}
          >
            <option value="">
              {regions.loading && !regions.data
                ? t('start.region.loading')
                : t('start.region.placeholder')}
            </option>
            {regions.data?.items.map((r) => (
              <option key={r.regionId} value={r.regionId}>
                {r.name}
              </option>
            ))}
          </select>
          {regions.error !== null && !regions.data && (
            <ErrorState error={regions.error} onRetry={regions.reload} />
          )}
        </div>

        {selected && <Coverage region={selected} />}

        {region !== '' && (
          <SearchPlan
            preview={preview.data}
            loading={preview.loading || !settled}
            sectorIds={sectorIds}
            setSectorIds={(ids) => {
              setSectorIds(ids);
              setPrefilled(false);
            }}
            wordingsText={wordingsText}
            setWordingsText={setWordingsText}
            problem={problem}
            emptyPlan={emptyPlan}
            cellKeys={cellKeys}
            clearCells={() => setCellKeys([])}
            prefilled={prefilled}
          />
        )}

        <div className="form-field">
          <label htmlFor={capId}>{t('start.cap')}</label>
          <input
            id={capId}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={capText}
            onChange={(e) => setCapText(e.target.value)}
            onBlur={() => setCapTouched(true)}
            aria-describedby={capHelpId}
            aria-invalid={capTouched && cap === null}
          />
          <small id={capHelpId} className={capTouched && cap === null ? 'form-error' : 'muted'}>
            {capTouched && cap === null ? t('start.cap.invalid') : t('start.cap.help')}
          </small>
        </div>

        <Preview
          region={region}
          preview={preview.data}
          loading={preview.loading || !settled}
          error={preview.error}
          onRetry={preview.reload}
        />

        <button type="submit" className="button button-primary" disabled={!canReview}>
          {t('start.review')}
        </button>
      </form>

      {started && (
        <p role="status" className="notice">
          {t('start.started', { region: started.region })}{' '}
          <Link to={`/leadgen/runs/${started.id}`}>{t('start.started.link')}</Link>
        </p>
      )}

      {confirming && (
        <Modal title={t('start.confirm.title')} onClose={() => !starting && setConfirming(false)}>
          <div className="modal-body">
            <p>
              {preview.data
                ? t('start.confirm.body', {
                    region: regionName,
                    cap: formatUsd(cap),
                    cost: formatUsd(preview.data.cost.totalUsd),
                    leads: formatNumber(preview.data.volume.leads),
                  })
                : t('start.confirm.bodyNoEstimate', { region: regionName, cap: formatUsd(cap) })}
            </p>
            {preview.data && (
              <p data-testid="confirm-queries">
                {t('start.confirm.queries', {
                  queries: formatNumber(preview.data.queriesTotal),
                  cells: formatNumber(preview.data.cells.length),
                })}
              </p>
            )}
            {startError !== null && (
              <p className="form-error" role="alert">
                {describeError(t, startError, {
                  paid_runs_disabled: 'start.error.paid_runs_disabled',
                })}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="button"
              data-autofocus
              disabled={starting}
              onClick={() => setConfirming(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={starting}
              onClick={() => void start()}
            >
              {starting ? t('start.confirm.submitting') : t('start.confirm.submit')}
            </button>
          </footer>
        </Modal>
      )}
    </Widget>
  );
}

function Coverage({ region }: { region: RegionSummary }) {
  const t = useT();
  const unknown = t('start.coverage.unknown');
  return (
    <section className="coverage" aria-label={t('start.coverage.title', { region: region.name })}>
      <h3>{t('start.coverage.title', { region: region.name })}</h3>
      {!region.hasBounds && <p className="form-error">{t('start.coverage.noBounds')}</p>}
      <dl className="stats">
        <div>
          <dt>{t('start.coverage.coverage')}</dt>
          <dd>{region.coverage === null ? unknown : formatPercent(region.coverage)}</dd>
        </div>
        <div>
          <dt>{t('start.coverage.yield')}</dt>
          <dd>
            {region.newPlacesPerQuery === null
              ? unknown
              : formatNumber(region.newPlacesPerQuery, 1)}
          </dd>
        </div>
        <div>
          <dt>{t('start.coverage.costPerLead')}</dt>
          <dd>{region.costPerLeadUsd === null ? unknown : formatUsd(region.costPerLeadUsd)}</dd>
        </div>
        <div>
          <dt>{t('start.coverage.leads')}</dt>
          <dd>{formatNumber(region.leads)}</dd>
        </div>
        <div>
          <dt>{t('start.coverage.spend')}</dt>
          <dd>{formatUsd(region.spendUsd)}</dd>
        </div>
        <div>
          <dt>{t('start.coverage.status')}</dt>
          <dd>
            {region.status === 'saturated'
              ? t('start.coverage.saturated')
              : t('start.coverage.active')}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Preview({
  region,
  preview,
  loading,
  error,
  onRetry,
}: {
  region: string;
  preview: RunPreview | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <section className="preview" aria-live="polite" aria-label={t('start.preview.title')}>
      <h3>
        {t('start.preview.title')} <KindTag kind="estimate" />
      </h3>
      {region === '' ? (
        <p className="muted">{t('start.preview.pick')}</p>
      ) : error !== null && !preview ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !preview ? (
        <LoadingState label={t('start.preview.loading')} />
      ) : (
        <div className={loading ? 'is-stale' : ''}>
          {loading && <p className="muted">{t('start.preview.loading')}</p>}
          {preview.blockers.length > 0 && (
            <div className="state state-error" role="alert">
              <p className="state-title">{t('start.preview.blockers')}</p>
              <ul>
                {preview.blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="stats">
            <div>
              <dt>{t('start.preview.queries')}</dt>
              <dd>{formatNumber(preview.queriesTotal)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.places')}</dt>
              <dd>{formatNumber(preview.volume.places)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.qualified')}</dt>
              <dd>{formatNumber(preview.volume.qualified)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.people')}</dt>
              <dd>{formatNumber(preview.volume.people)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.leads')}</dt>
              <dd>{formatNumber(preview.volume.leads)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.cost')}</dt>
              <dd>{formatUsd(preview.cost.totalUsd)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.perLead')}</dt>
              <dd>{preview.cost.perLeadUsd === null ? '—' : formatUsd(preview.cost.perLeadUsd)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.upperBound')}</dt>
              <dd>{formatUsd(preview.cost.upperBoundUsd)}</dd>
            </div>
            <div>
              <dt>{t('start.preview.monthRemaining')}</dt>
              <dd>
                {preview.limits.monthRemainingUsd === null
                  ? t('start.preview.noMonthCap')
                  : formatUsd(preview.limits.monthRemainingUsd)}
              </dd>
            </div>
            <div>
              <dt>{t('start.preview.activeRuns')}</dt>
              <dd>
                {preview.limits.activeRuns} / {preview.limits.maxActiveRuns}
              </dd>
            </div>
          </dl>
          <details>
            <summary>{t('start.preview.assumptions')}</summary>
            <ul>
              {preview.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

function SearchPlan({
  preview,
  loading,
  sectorIds,
  setSectorIds,
  wordingsText,
  setWordingsText,
  problem,
  emptyPlan,
  cellKeys,
  clearCells,
  prefilled,
}: {
  preview: RunPreview | null;
  loading: boolean;
  sectorIds: string[] | null;
  setSectorIds: (ids: string[] | null) => void;
  wordingsText: string;
  setWordingsText: (text: string) => void;
  problem: 'tooMany' | 'tooLong' | null;
  emptyPlan: boolean;
  cellKeys: string[];
  clearCells: () => void;
  prefilled: boolean;
}) {
  const t = useT();
  const wordingsId = useId();
  const sectors = preview?.sectors ?? [];
  const allIds = sectors.map((s) => s.id);
  const chosen = new Set(sectorIds ?? allIds);

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Everything ticked is the default, which the server treats as "all sectors".
    setSectorIds(next.size === allIds.length ? null : allIds.filter((x) => next.has(x)));
  }
  const sectorName = (id: string | null) =>
    id === null ? t('plan.custom') : (sectors.find((s) => s.id === id)?.name ?? id);

  const byCell = new Map<string, NonNullable<RunPreview['queries']>>();
  for (const q of preview?.queries ?? [])
    byCell.set(q.cellKey, [...(byCell.get(q.cellKey) ?? []), q]);

  return (
    <section className="search-plan" aria-label={t('plan.title')}>
      <h3>{t('plan.title')}</h3>
      {prefilled && (
        <p className="notice" role="status">
          {t('plan.prefilled')}
        </p>
      )}
      <fieldset className="plan-sectors">
        <legend>{t('plan.sectors')}</legend>
        <div className="plan-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => setSectorIds(null)}
            disabled={sectorIds === null}
          >
            {t('plan.sectors.all')}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setSectorIds([])}
            disabled={sectorIds !== null && sectorIds.length === 0}
          >
            {t('plan.sectors.none')}
          </button>
        </div>
        {sectors.length === 0 ? (
          <p className="muted">{t('plan.sectors.loading')}</p>
        ) : (
          <ul className="checks">
            {sectors.map((s) => (
              <li key={s.id}>
                <label>
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />{' '}
                  {s.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="form-field">
        <label htmlFor={wordingsId}>{t('plan.wordings')}</label>
        <textarea
          id={wordingsId}
          rows={3}
          value={wordingsText}
          onChange={(e) => setWordingsText(e.target.value)}
          aria-describedby={`${wordingsId}-help`}
          aria-invalid={problem !== null}
        />
        <small id={`${wordingsId}-help`} className={problem !== null ? 'form-error' : 'muted'}>
          {problem === 'tooMany'
            ? t('plan.wordings.tooMany', { max: MAX_CUSTOM_WORDINGS })
            : problem === 'tooLong'
              ? t('plan.wordings.tooLong', { max: MAX_WORDING_CHARS })
              : t('plan.wordings.help', { max: MAX_CUSTOM_WORDINGS, chars: MAX_WORDING_CHARS })}
        </small>
      </div>
      {emptyPlan && (
        <p className="form-error" role="alert">
          {t('plan.empty')}
        </p>
      )}

      {cellKeys.length > 0 && (
        <p className="notice" role="status">
          {t('plan.cells', { cells: cellKeys.join(', ') })}{' '}
          <button type="button" className="link-button" onClick={clearCells}>
            {t('plan.cells.clear')}
          </button>
        </p>
      )}

      {preview && (
        <details className={loading ? 'is-stale' : ''} open>
          <summary>
            {t('plan.queries', {
              shown: formatNumber(preview.queries.length),
              total: formatNumber(preview.queriesTotal),
            })}
          </summary>
          {[...byCell.entries()].map(([cell, list]) => (
            <div key={cell} className="plan-cell">
              <h4>{t('plan.cell', { cell })}</h4>
              <ul>
                {list.map((q) => (
                  <li key={`${q.cellKey}|${q.wording}`}>
                    {q.wording} <span className="muted">({sectorName(q.sectorId)})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {preview.queriesTotal > preview.queries.length && (
            <p className="muted">
              {t('plan.more', {
                count: formatNumber(preview.queriesTotal - preview.queries.length),
              })}
            </p>
          )}
        </details>
      )}
    </section>
  );
}
