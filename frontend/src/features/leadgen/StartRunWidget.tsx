import type { RegionSummary, RunPreview, RunSummary } from '@lead-gen-crm/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { NumberStepper } from '../../components/shared/NumberStepper.js';
import { Select } from '../../components/shared/Select.js';
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
import { RegionChips } from './startrun/RegionChips.js';
import { sectorLook } from '../crm/sectorLook.js';
import {
  QUICK_CAPS_USD,
  capProblem,
  capText as formatCap,
  MAX_CAP_USD,
  MIN_CAP_USD,
  type CapProblem,
  combinePreviews,
  confirmReason,
  parseCap,
  readCap,
  regionProgress,
  runsToStart,
  saveCap,
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
  /** The runs started, and the names of regions that were chosen but had to wait. */
  onStarted: (runs: RunSummary[], notStarted: string[]) => void;
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
  // Opened from a sector: any number of regions, one run each.
  const [many, setMany] = useState(false);
  const [regionIds, setRegionIds] = useState<string[]>([]);
  // A sector only arrives from the coverage page; otherwise every search combination is used.
  const [prefilledSectors, setPrefilledSectors] = useState<string[] | null>(null);
  const [cellKeys, setCellKeys] = useState<string[]>([]);
  const [capText, setCapText] = useState(() => formatCap(readCap()));
  const [capTouched, setCapTouched] = useState(false);
  // The server's own maximum arrives with the first estimate; until then the default holds.
  const [serverMax, setServerMax] = useState<number | null>(null);
  const maxCap = serverMax ?? MAX_CAP_USD;
  const capMessage = (issue: CapProblem) =>
    issue === 'low'
      ? t('start.cap.low', { min: formatUsd(MIN_CAP_USD) })
      : issue === 'high'
        ? t('start.cap.high', { max: formatUsd(maxCap) })
        : t('start.cap.invalid');
  const [wordingsText, setWordingsText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  const regions = useResource(() => api.regions.list({ limit: 100 }));
  const suggestion = useResource(() => api.regions.suggestion());
  const coverage = useResource(() => api.coverage.get());

  useEffect(() => {
    if (!prefill) return;
    setMany(prefill.regionIds !== undefined);
    setRegionIds(prefill.regionIds ?? []);
    setRegion(prefill.regionId ?? '');
    setPrefilledSectors(prefill.sectorIds ?? null);
    setCellKeys(prefill.cellKeys ?? []);
    setConfirming(false);
  }, [prefill]);

  const sectors = coverage.data?.sectors ?? [];
  // Empty = no sector named: the server searches every import/export combination.
  const selected = useMemo(() => prefilledSectors ?? [], [prefilledSectors]);
  const sectorBody = useMemo(
    () => (selected.length > 0 ? { sectorIds: selected } : {}),
    [selected],
  );

  const capIssue = capProblem(capText, maxCap);
  const cap = parseCap(capText, maxCap);
  const wordings = useMemo(() => parseWordings(wordingsText), [wordingsText]);
  const problem = wordingsProblem(wordings);
  const targets = many ? regionIds : region ? [region] : [];
  const planKey = JSON.stringify([selected, wordings, cellKeys, targets]);
  const debouncedCap = useDebounced(cap, PREVIEW_DEBOUNCE_MS);
  const debouncedPlan = useDebounced(planKey, PREVIEW_DEBOUNCE_MS);
  const settled = debouncedCap === cap && debouncedPlan === planKey;
  const selectedRegion: RegionSummary | undefined = regions.data?.items.find(
    (r) => r.regionId === region,
  );
  const canPreview =
    targets.length > 0 && (many || selectedRegion?.hasBounds !== false) && problem === null;
  // One estimate per region that a start could begin, asked in the same way as for one region.
  // The first answer says how many runs can go at once, so no more are asked for than can start.
  const previews = useResource<RunPreview[]>(
    async () => {
      const [ids, words, cells, regionList] = JSON.parse(debouncedPlan) as [
        string[],
        string[],
        string[],
        string[],
      ];
      const one = (regionId: string) =>
        api.runs.preview({
          regionId,
          ...(ids.length > 0 ? { sectorIds: ids } : {}),
          ...(words.length > 0 ? { customWordings: words } : {}),
          ...(cells.length > 0 ? { cellKeys: cells } : {}),
          ...(debouncedCap !== null ? { budgetCapUsd: debouncedCap } : {}),
        });
      const first = await one(regionList[0]!);
      const room = Math.max(1, runsToStart(regionList.length, first.limits));
      return [first, ...(await Promise.all(regionList.slice(1, room).map(one)))];
    },
    { enabled: canPreview && settled, deps: [debouncedCap, debouncedPlan] },
  );
  const estimating = previews.loading || !settled;
  const list = canPreview ? previews.data : null;
  const data = list ? combinePreviews(list) : null;
  const dataMax = data?.limits.maxRunCapUsd ?? null;
  useEffect(() => {
    if (dataMax !== null) setServerMax(dataMax);
  }, [dataMax]);
  const toStart = runsToStart(targets.length, list?.[0]?.limits ?? null);
  const names = (ids: string[]) =>
    ids.map((id) => regions.data?.items.find((r) => r.regionId === id)?.name ?? id);

  // Why Start cannot be pressed, in the order a person would fix things.
  const blocker = data?.blockers[0]?.message ?? null;
  let reason: string | null = null;
  if (targets.length === 0) reason = t(many ? 'start.reason.regions' : 'start.reason.region');
  else if (!many && selectedRegion && !selectedRegion.hasBounds) reason = t('start.noBounds');
  else if (problem !== null) reason = t('start.reason.wordings');
  else if (cap === null) reason = capMessage(capIssue ?? 'invalid');
  else if (estimating) reason = t('start.reason.estimating');
  else if (previews.error !== null && !previews.data) reason = t('start.reason.estimateFailed');
  else if (blocker) reason = blocker;
  else if (
    toStart > 1 &&
    cap !== null &&
    data?.limits.monthRemainingUsd != null &&
    cap * toStart > data.limits.monthRemainingUsd
  ) {
    reason = t('start.many.month', {
      n: toStart,
      total: formatUsd(cap * toStart),
      left: formatUsd(data.limits.monthRemainingUsd),
    });
  }
  // Not a reason to wait: some chosen regions will not start, and the person is told which.
  const notice =
    many && list && toStart > 0 && toStart < targets.length
      ? t('start.many.limit', {
          max: list[0]!.limits.maxActiveRuns,
          active: list[0]!.limits.activeRuns,
          start: toStart,
          skipped: names(targets.slice(toStart)).join(', '),
        })
      : null;

  const need = cap !== null && data ? confirmReason(cap, data.cost.totalUsd, toStart) : null;

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
    const started: RunSummary[] = [];
    const begin = targets.slice(0, toStart);
    try {
      // The only calls that start runs: each needs the cap, and `confirm` says the person saw it.
      for (const target of begin) {
        started.push(
          await api.runs.start({
            regionId: target,
            ...sectorBody,
            ...(wordings.length > 0 ? { customWordings: wordings } : {}),
            ...(cellKeys.length > 0 ? { cellKeys } : {}),
            budgetCapUsd: cap,
            confirm: true,
          }),
        );
      }
      saveCap(cap);
      onStarted(started, names(targets.slice(toStart)));
    } catch (err) {
      if (started.length > 0) {
        // Some runs are going: say so, and name the regions the server turned down.
        saveCap(cap);
        onStarted(started, names(targets.slice(started.length)));
      } else {
        setStartError(err);
        setConfirming(false);
      }
    } finally {
      setStarting(false);
    }
  }

  const sugg = suggestion.data;
  const suggestedRegion = sugg?.regionId
    ? regions.data?.items.find((r) => r.regionId === sugg.regionId)
    : undefined;
  const regionOption = (r: RegionSummary) => {
    if (!r.hasBounds) return t('start.region.noBounds');
    return t('start.region.option', {
      leads: t(r.leads === 1 ? 'start.region.lead' : 'start.region.leads', { n: r.leads }),
      progress: t(`start.region.${regionProgress(r)}`),
    });
  };

  return (
    <>
      <div className="modal-body sr" ref={root}>
        <div className="sr-cols">
          <div className="sr-left">
            {many ? (
              regions.data ? (
                <RegionChips
                  regions={regions.data.items}
                  selected={regionIds}
                  onChange={(ids) => {
                    setRegionIds(ids);
                    setConfirming(false);
                  }}
                />
              ) : regions.error !== null ? (
                <ErrorState error={regions.error} onRetry={regions.reload} />
              ) : (
                <p className="muted">{t('start.region.loading')}</p>
              )
            ) : (
              <div className="form-field">
                <label htmlFor={regionId}>{t('start.region')}</label>
                <Select
                  id={regionId}
                  value={region}
                  autoFocus
                  placeholder={
                    regions.loading && !regions.data
                      ? t('start.region.loading')
                      : t('start.region.placeholder')
                  }
                  options={[
                    {
                      value: '',
                      label:
                        regions.loading && !regions.data
                          ? t('start.region.loading')
                          : t('start.region.placeholder'),
                    },
                    ...(regions.data?.items ?? []).map((r) => ({
                      value: r.regionId,
                      label: r.name,
                      secondary: regionOption(r),
                      disabled: !r.hasBounds,
                    })),
                  ]}
                  onChange={(v) => {
                    setRegion(v);
                    setPrefilledSectors(null);
                    setCellKeys([]);
                    setConfirming(false);
                  }}
                />
                {regions.error !== null && !regions.data && (
                  <ErrorState error={regions.error} onRetry={regions.reload} />
                )}
              </div>
            )}

            {coverage.error !== null && !coverage.data ? (
              <ErrorState error={coverage.error} onRetry={coverage.reload} />
            ) : many ? (
              // From a sector: that sector is fixed, and only the regions can be many.
              <div className="form-field sr-fixed-sector">
                <span className="sr-fixed-label">{t('start.sector.fixed')}</span>
                <ul className="sr-fixed-list">
                  {selected.map((id) => {
                    const { Icon, color } = sectorLook(id);
                    return (
                      <li key={id} className="sr-fixed-chip" style={{ background: color }}>
                        <Icon size={14} aria-hidden="true" />
                        {sectors.find((x) => x.id === id)?.name ?? id}
                      </li>
                    );
                  })}
                </ul>
                <small className="muted">{t('start.sector.fixed.help')}</small>
              </div>
            ) : selected.length > 0 ? (
              // From the coverage page: that one sector, shown, not chosen here.
              <p className="muted sr-all-sectors">
                {t('start.sector.one', {
                  sector: sectors.find((x) => x.id === selected[0])?.name ?? selected[0]!,
                })}
              </p>
            ) : (
              <p className="muted sr-all-sectors">{t('start.sector.all')}</p>
            )}

            <div className="form-field sr-cap">
              <label htmlFor={capId}>{t(toStart > 1 ? 'start.cap.each' : 'start.cap')}</label>
              <div className="sr-cap-row">
                <NumberStepper
                  id={capId}
                  prefix="$"
                  value={capText}
                  min={MIN_CAP_USD}
                  max={maxCap}
                  step={0.5}
                  decimals={2}
                  invalid={capTouched && capIssue !== null}
                  aria-describedby={capHelpId}
                  onChange={(text) => {
                    setCapText(text);
                    setConfirming(false);
                  }}
                  onBlur={() => setCapTouched(true)}
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
              <small id={capHelpId} className={capTouched && capIssue ? 'form-error' : 'muted'}>
                {capTouched && capIssue ? capMessage(capIssue) : t('start.cap.help')}
              </small>
            </div>
          </div>

          <div className="sr-right">
            <EstimateCard
              ready={canPreview}
              preview={data}
              loading={estimating}
              error={previews.error}
              onRetry={previews.reload}
              cap={cap}
            />
            <section className="sr-suggest" aria-live="polite">
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
                      setMany(false);
                      setRegion(sugg.regionId!);
                      setPrefilledSectors(null);
                      setCellKeys([]);
                    }}
                    disabled={!many && region === sugg.regionId}
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
                        cap: formatUsd((cap ?? 0) * Math.max(toStart, 1)),
                      })
                    : null,
                  need.bigCap ? t('start.confirm.bigCap', { cap: formatUsd(cap) }) : null,
                ]
                  .filter(Boolean)
                  .join(' ')
              : (reason ?? notice)}
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
            {cap === null
              ? t('start.submit.noCap')
              : toStart > 1
                ? t('start.submit.many', { n: toStart, cap: formatUsd(cap) })
                : t('start.submit', { cap: formatUsd(cap) })}
          </button>
        )}
      </footer>
    </>
  );
}
