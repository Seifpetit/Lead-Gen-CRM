import type { CountryInfo, RegionSummary } from '@lead-gen-crm/shared';
import { ChevronDown, ChevronUp, Play, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../i18n/index.js';
import { formatDay, formatNumber, formatPercent, formatUsd } from '../../../lib/format.js';
import { isExplored } from '../../../lib/coverageView.js';
import { TONE_COLORS } from './worldStyle.js';
import { regionTone, type CountryTotals } from './worldView.js';

/**
 * "Coverage by region", floating over the bottom left of the map. Closed, it is a bar; with no
 * country picked, opening it shows the totals of every country; with a country picked it opens
 * on its own and lists that country's regions. Hovering a row lights the region on the map and
 * hovering the region lights the row.
 */
export function RegionPanel({
  open,
  onToggle,
  country,
  totals,
  summaries,
  pinCounts,
  hover,
  onHover,
  selected,
  onSelect,
  onPickCountry,
  onStart,
}: {
  open: boolean;
  onToggle: () => void;
  /** The picked country, or null for the whole world. */
  country: CountryInfo | null;
  totals: readonly CountryTotals[];
  /** The picked country's regions, in display order. */
  summaries: readonly RegionSummary[];
  pinCounts: ReadonlyMap<string, number>;
  hover: string | null;
  onHover: (regionId: string | null) => void;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  onPickCountry: (code: CountryInfo['code']) => void;
  onStart: (regionId: string) => void;
}) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const picked = summaries.find((r) => r.regionId === selected) ?? null;
  const mine = totals.find((c) => c.code === country?.code) ?? null;

  // A region lit from the map scrolls into view in the list.
  useEffect(() => {
    if (!hover) return;
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-region]') ?? [];
    const row = [...rows].find((el) => el.dataset['region'] === hover);
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [hover]);

  const sum = (pick: (c: CountryTotals) => number) => totals.reduce((n, c) => n + pick(c), 0);
  const title = country
    ? t('wm.regions.titleOf', { country: country.name })
    : t('wm.regions.title');

  return (
    <section className={`wm-regions${open ? ' is-open' : ''}`} aria-label={t('wm.regions.title')}>
      <button
        type="button"
        className="wm-regions-head"
        aria-expanded={open}
        onClick={onToggle}
        title={open ? t('wm.regions.collapse') : t('wm.regions.expand')}
      >
        <span className="wm-regions-title">{title}</span>
        <span className="wm-regions-sub">
          {t('wm.regions.companies', {
            count: formatNumber(mine ? mine.companies : sum((c) => c.companies)),
          })}
        </span>
        {open ? (
          <ChevronDown size={16} aria-hidden="true" />
        ) : (
          <ChevronUp size={16} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="wm-regions-body">
          {country === null || mine === null ? (
            <>
              <dl className="wm-stats">
                <div>
                  <dt>{t('wm.stat.companies')}</dt>
                  <dd>{formatNumber(sum((c) => c.companies))}</dd>
                </div>
                <div>
                  <dt>{t('cov.leads')}</dt>
                  <dd>{formatNumber(sum((c) => c.leads))}</dd>
                </div>
                <div>
                  <dt>{t('wm.stat.spent')}</dt>
                  <dd>{formatUsd(sum((c) => c.spendUsd))}</dd>
                </div>
              </dl>
              <p className="wm-hint">{t('wm.regions.hint.world')}</p>
              <ul className="wm-list">
                {totals.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      className="wm-row"
                      disabled={!c.enabled}
                      aria-disabled={!c.enabled}
                      onClick={() => onPickCountry(c.code)}
                    >
                      <span className="wm-row-name">{c.name}</span>
                      <span className="wm-row-meta">
                        {c.enabled
                          ? t('wm.country.row', {
                              companies: formatNumber(c.companies),
                              explored: formatNumber(c.regionsExplored),
                              regions: formatNumber(c.regions),
                            })
                          : `${t('country.off')}${c.disabledReason ? `: ${c.disabledReason}` : ''}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <dl className="wm-stats">
                <div>
                  <dt>{t('wm.stat.companies')}</dt>
                  <dd>{formatNumber(mine.companies)}</dd>
                </div>
                <div>
                  <dt>{t('wm.stat.regions')}</dt>
                  <dd>{`${formatNumber(mine.regionsExplored)}/${formatNumber(mine.regions)}`}</dd>
                </div>
                <div>
                  <dt>{t('wm.stat.spent')}</dt>
                  <dd>{formatUsd(mine.spendUsd)}</dd>
                </div>
              </dl>

              {picked && (
                <div className="wm-detail">
                  <div className="wm-detail-head">
                    <h2>{picked.name}</h2>
                    <button
                      type="button"
                      className="wm-icon"
                      aria-label={t('wm.regions.clear')}
                      title={t('wm.regions.clear')}
                      onClick={() => onSelect(null)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <p className="wm-detail-status">{t(`wm.status.${regionTone(picked)}`)}</p>
                  <div
                    className="wm-bar"
                    role="img"
                    aria-label={t('cov.bar.value', { percent: formatPercent(picked.coverage) })}
                  >
                    <span style={{ width: `${Math.round((picked.coverage ?? 0) * 100)}%` }} />
                  </div>
                  <dl className="wm-facts">
                    <div>
                      <dt>{t('cov.bar.head')}</dt>
                      <dd>{formatPercent(picked.coverage)}</dd>
                    </div>
                    <div>
                      <dt>{t('wm.stat.companies')}</dt>
                      <dd>{formatNumber(pinCounts.get(picked.regionId) ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>{t('cov.leads')}</dt>
                      <dd>{formatNumber(picked.leads)}</dd>
                    </div>
                    <div>
                      <dt>{t('wm.stat.spent')}</dt>
                      <dd>{formatUsd(picked.spendUsd)}</dd>
                    </div>
                    <div>
                      <dt>{t('cov.lastRun')}</dt>
                      <dd>{picked.lastRunAt ? formatDay(picked.lastRunAt) : t('cov.never')}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="button button-primary wm-start"
                    disabled={!picked.hasBounds}
                    onClick={() => onStart(picked.regionId)}
                  >
                    <Play size={14} aria-hidden="true" />
                    {t('cov.start.region', { region: picked.name })}
                  </button>
                </div>
              )}

              <ul className="wm-list" ref={list}>
                {summaries.map((r) => {
                  const explored = isExplored(r);
                  return (
                    <li key={r.regionId}>
                      <button
                        type="button"
                        className={`wm-row${hover === r.regionId ? ' is-hot' : ''}`}
                        data-region={r.regionId}
                        aria-pressed={selected === r.regionId}
                        aria-disabled={!explored}
                        disabled={!explored}
                        onMouseEnter={() => onHover(r.regionId)}
                        onMouseLeave={() => onHover(null)}
                        onFocus={() => onHover(r.regionId)}
                        onBlur={() => onHover(null)}
                        onClick={() => onSelect(selected === r.regionId ? null : r.regionId)}
                      >
                        <span
                          className="wm-dot"
                          style={{ background: TONE_COLORS[regionTone(r)] }}
                          aria-hidden="true"
                        />
                        <span className="wm-row-name">{r.name}</span>
                        <span className="wm-row-meta">
                          {explored
                            ? t('wm.region.row', {
                                percent: formatPercent(r.coverage),
                                leads: formatNumber(r.leads),
                              })
                            : t('cov.notExplored')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
