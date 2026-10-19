import type { RegionSummary, RunPreview, RunSummary } from '@lead-gen-crm/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { ErrorState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatUsd } from '../../lib/format.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useResource } from '../../lib/useResource.js';
import {
  AdvancedSection,
  MAX_CUSTOM_WORDINGS,
  MAX_WORDING_CHARS,
  parseWordings,
  wordingsProblem,
} from './startrun/AdvancedSection.js';
import { EstimateCard } from './startrun/EstimateCard.js';
import { SectorChips } from './startrun/SectorChips.js';
import {
  QUICK_CAPS_USD,
  capText as formatCap,
  confirmReason,
  parseCap,
  readCap,
  regionProgress,
  saveCap,
  suggestedSectors,
} from './startrun/startPlan.js';
import type { StartPrefill } from './prefill.js';

export const PREVIEW_DEBOUNCE_MS = 300;
export { MAX_CUSTOM_WORDINGS, MAX_WORDING_CHARS, parseWordings };

/**
 * Start a run on one screen: the region, the sectors (chips) and the spend cap on the left, the
 * live estimate on the right, one Start button that says what the cap is. The estimate is only
 * a preview; nothing is spent until Start, and the server still enforces every cap and limit.
 * Renders the body and footer of the dialog it sits in.
 */
export function StartRunWidget({
  onStarted,
  onCancel,
  prefill,
}: {
  onStarted: (run: RunSummary) => void;
  onCancel?: () => void;
  /** Set by the coverage page; each new object (a fresh click) is applied once. */
  prefill?: (StartPrefill & { nonce: number }) | null;
}) {
  const t = useT();
  const api = useApi();
  const regionId = useId();
  const capId = useId();
  const capHelpId = useId();
  const reasonId = useId();
  const root = useRef<HTMLDivElement>(null);

  const [region, setRegion] = useState('');
  // null = untouched: the default for the region (the coverage prefill, else the suggested sector).
  const [picked, setPicked] = useState<string[] | null>(null);
  const [prefilledSectors, setPrefilledSectors] = useState<string[] | null>(null);
  const [cellKeys, setCellKeys] = useState<string[]>([]);
  const [capText, setCapText] = useState(() => formatCap(readCap()));
  const [capTouched, setCapTouched] = useState(false);
  const [wordingsText, setWordingsText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  const regions = useResource(() => api.regions.list({ limit: 100 }));
  const suggestion = useResource(() => api.regions.suggestion());
  const coverage = useResource(() => api.coverage.get());

  useEffect(() => {
    if (!prefill) return;
    setRegion(prefill.regionId);
    setPrefilledSectors(prefill.sectorIds ?? null);
    setPicked(null);
    setCellKeys(prefill.cellKeys ?? []);
    setConfirming(false);
  }, [prefill]);

  // From the coverage page, the chosen sector is where the focus starts.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !prefill?.sectorIds?.length || !coverage.data) return;
    const chip = root.current?.querySelector<HTMLElement>(
      `[data-sector="${prefill.sectorIds[0]}"]`,
    );
    if (chip) {
      chip.focus();
      focused.current = true;
    }
  }, [prefill, coverage.data]);

  const sectors = coverage.data?.sectors ?? [];
  const suggested = useMemo(
    () => (coverage.data && region ? suggestedSectors(coverage.data, region) : []),
    [coverage.data, region],
  );
  const selected = picked ?? prefilledSectors ?? suggested;

  const cap = parseCap(capText);
  const wordings = useMemo(() => parseWordings(wordingsText), [wordingsText]);
  const problem = wordingsProblem(wordings);
  const planned = selected.length > 0 || wordings.length > 0;
  const planKey = JSON.stringify([selected, wordings, cellKeys]);
  const debouncedRegion = useDebounced(region, PREVIEW_DEBOUNCE_MS);
  const debouncedCap = useDebounced(cap, PREVIEW_DEBOUNCE_MS);
  const debouncedPlan = useDebounced(planKey, PREVIEW_DEBOUNCE_MS);
  const settled = debouncedRegion === region && debouncedCap === cap && debouncedPlan === planKey;
  const selectedRegion: RegionSummary | undefined = regions.data?.items.find(
    (r) => r.regionId === region,
  );
  const canPreview =
    region !== '' && selectedRegion?.hasBounds !== false && planned && problem === null;
  const preview = useResource<RunPreview>(
    () => {
      const [ids, words, cells] = JSON.parse(debouncedPlan) as [string[], string[], string[]];
      return api.runs.preview({
        regionId: debouncedRegion,
        sectorIds: ids,
        ...(words.length > 0 ? { customWordings: words } : {}),
        ...(cells.length > 0 ? { cellKeys: cells } : {}),
        ...(debouncedCap !== null ? { budgetCapUsd: debouncedCap } : {}),
      });
    },
    { enabled: canPreview && settled, deps: [debouncedRegion, debouncedCap, debouncedPlan] },
  );
  const estimating = preview.loading || !settled;
  const data = canPreview ? preview.data : null;

  // Why Start cannot be pressed, in the order a person would fix things.
  const blocker = data?.blockers[0]?.message ?? null;
  let reason: string | null = null;
  if (region === '') reason = t('start.reason.region');
  else if (selectedRegion && !selectedRegion.hasBounds) reason = t('start.noBounds');
  else if (!planned) reason = t('start.reason.sector');
  else if (problem !== null) reason = t('start.reason.wordings');
  else if (cap === null) reason = t('start.cap.invalid');
  else if (estimating) reason = t('start.reason.estimating');
  else if (preview.error !== null && !preview.data) reason = t('start.reason.estimateFailed');
  else if (blocker) reason = blocker;

  const need = cap !== null && data ? confirmReason(cap, data.cost.totalUsd) : null;

  function pressStart() {
    if (reason !== null || cap === null) return;
    setStartError(null);
    if (need) setConfirming(true);
    else void start();
  }

  async function start() {
    if (cap === null) return;
    setStarting(true);
    setStartError(null);
    try {
      // The only call that starts a run: it needs the cap, and `confirm` says the person saw it.
      const run = await api.runs.start({
        regionId: region,
        sectorIds: selected,
        ...(wordings.length > 0 ? { customWordings: wordings } : {}),
        ...(cellKeys.length > 0 ? { cellKeys } : {}),
        budgetCapUsd: cap,
        confirm: true,
      });
      saveCap(cap);
      onStarted(run);
    } catch (err) {
      setStartError(err);
      setConfirming(false);
    } finally {
      setStarting(false);
    }
  }

  const sugg = suggestion.data;
  const suggestedRegion = sugg?.regionId
    ? regions.data?.items.find((r) => r.regionId === sugg.regionId)
    : undefined;
  const regionOption = (r: RegionSummary) => {
    if (!r.hasBounds) return t('start.region.noBounds', { name: r.name });
    return t('start.region.option', {
      name: r.name,
      leads: t(r.leads === 1 ? 'start.region.lead' : 'start.region.leads', { n: r.leads }),
      progress: t(`start.region.${regionProgress(r)}`),
    });
  };

  return (
    <>
      <div className="modal-body sr" ref={root}>
        <section className="sr-suggest" aria-live="polite" aria-label={t('start.suggestion.title')}>
          <strong>{t('start.suggestion.title')}</strong>
          {suggestion.loading && !sugg ? (
            <span className="muted">{t('start.suggestion.loading')}</span>
          ) : suggestion.error && !sugg ? (
            <span className="muted">{t('start.suggestion.none')}</span>
          ) : sugg?.regionId ? (
            <>
              <span className="sr-suggest-text" title={sugg.reason}>
                {suggestedRegion?.name ?? sugg.regionId}: {sugg.reason}
              </span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setRegion(sugg.regionId!);
                  setPicked(null);
                  setPrefilledSectors(null);
                  setCellKeys([]);
                }}
                disabled={region === sugg.regionId}
              >
                {t('start.suggestion.use', { region: suggestedRegion?.name ?? sugg.regionId })}
              </button>
            </>
          ) : (
            <span className="muted sr-suggest-text">
              {sugg?.reason || t('start.suggestion.none')}
            </span>
          )}
        </section>

        <div className="sr-cols">
          <div className="sr-left">
            <div className="form-field">
              <label htmlFor={regionId}>{t('start.region')}</label>
              <select
                id={regionId}
                value={region}
                data-autofocus
                onChange={(e) => {
                  setRegion(e.target.value);
                  setPicked(null);
                  setPrefilledSectors(null);
                  setCellKeys([]);
                  setConfirming(false);
                }}
              >
                <option value="">
                  {regions.loading && !regions.data
                    ? t('start.region.loading')
                    : t('start.region.placeholder')}
                </option>
                {regions.data?.items.map((r) => (
                  <option key={r.regionId} value={r.regionId} disabled={!r.hasBounds}>
                    {regionOption(r)}
                  </option>
                ))}
              </select>
              {regions.error !== null && !regions.data && (
                <ErrorState error={regions.error} onRetry={regions.reload} />
              )}
            </div>

            {coverage.error !== null && !coverage.data ? (
              <ErrorState error={coverage.error} onRetry={coverage.reload} />
            ) : sectors.length === 0 ? (
              <p className="muted">{t('plan.sectors.loading')}</p>
            ) : (
              <SectorChips
                sectors={sectors}
                selected={selected}
                onChange={(ids) => {
                  setPicked(ids);
                  setConfirming(false);
                }}
              />
            )}

            <div className="form-field sr-cap">
              <label htmlFor={capId}>{t('start.cap')}</label>
              <div className="sr-cap-row">
                <input
                  id={capId}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  value={capText}
                  onChange={(e) => {
                    setCapText(e.target.value);
                    setConfirming(false);
                  }}
                  onBlur={() => setCapTouched(true)}
                  aria-describedby={capHelpId}
                  aria-invalid={capTouched && cap === null}
                />
                <ToggleGroup
                  label={t('start.cap.quick')}
                  hideLabel
                  value={QUICK_CAPS_USD.map(String).find((v) => Number(v) === cap) ?? ''}
                  onChange={(v) => {
                    setCapText(formatCap(Number(v)));
                    setConfirming(false);
                  }}
                  options={QUICK_CAPS_USD.map((n) => ({ value: String(n), label: `$${n}` }))}
                />
              </div>
              <small id={capHelpId} className={capTouched && cap === null ? 'form-error' : 'muted'}>
                {capTouched && cap === null ? t('start.cap.invalid') : t('start.cap.help')}
              </small>
            </div>
          </div>

          <div className="sr-right">
            <EstimateCard
              ready={canPreview}
              preview={data}
              loading={estimating}
              error={preview.error}
              onRetry={preview.reload}
              cap={cap}
            />
          </div>
        </div>

        <AdvancedSection
          preview={data}
          stale={estimating}
          wordingsText={wordingsText}
          setWordingsText={setWordingsText}
          problem={problem}
          cellKeys={cellKeys}
          clearCells={() => setCellKeys([])}
        />
      </div>

      <footer className="modal-footer sr-footer">
        <p id={reasonId} className="sr-reason" role={startError !== null ? 'alert' : 'status'}>
          {startError !== null
            ? describeError(t, startError, { paid_runs_disabled: 'start.error.paid_runs_disabled' })
            : confirming && need
              ? [
                  need.aboveCap
                    ? t('start.confirm.aboveCap', {
                        cost: formatUsd(data!.cost.totalUsd),
                        cap: formatUsd(cap),
                      })
                    : null,
                  need.bigCap ? t('start.confirm.bigCap', { cap: formatUsd(cap) }) : null,
                ]
                  .filter(Boolean)
                  .join(' ')
              : reason}
        </p>
        {onCancel && (
          <button type="button" className="button" disabled={starting} onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              className="button"
              disabled={starting}
              onClick={() => setConfirming(false)}
            >
              {t('start.confirm.back')}
            </button>
            <button
              type="button"
              className="button button-primary"
              data-autofocus
              disabled={starting}
              ref={(el) => el?.focus()}
              onClick={() => void start()}
            >
              {starting ? t('start.confirm.submitting') : t('start.confirm.yes')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-primary"
            aria-disabled={reason !== null || starting}
            aria-describedby={reasonId}
            onClick={pressStart}
          >
            {cap === null ? t('start.submit.noCap') : t('start.submit', { cap: formatUsd(cap) })}
          </button>
        )}
      </footer>
    </>
  );
}
