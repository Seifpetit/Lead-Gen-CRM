import type { Coverage, Lead } from '@lead-gen-crm/shared';
import { useMemo, useState } from 'react';
import { BarChart } from '../../../components/shared/BarChart.js';
import { LineChart } from '../../../components/shared/LineChart.js';
import { PanelSection } from '../../../components/shared/PanelSection.js';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { useT } from '../../../i18n/index.js';
import { formatNumber, formatShortDay, formatUsd } from '../../../lib/format.js';
import { leadsBySector, leadsPerDay, RANGES, showAsBars, type Range } from '../leadsView.js';

type Measure = 'leads' | 'cost';

/** 7, 30 or 90 days; each chart keeps its own. */
export function RangeControl({
  value,
  onChange,
  label,
}: {
  value: Range;
  onChange: (range: Range) => void;
  label: string;
}) {
  const t = useT();
  return (
    <ToggleGroup
      label={label}
      hideLabel
      value={String(value) as `${Range}`}
      options={RANGES.map((r) => ({
        value: String(r) as `${Range}`,
        label: t('charts.range.n', { days: r }),
      }))}
      onChange={(v) => onChange(Number(v) as Range)}
    />
  );
}

/** Leads found per day over the chosen range: bars while there is little to draw, a line otherwise. */
export function LeadsPerDaySection({
  leads,
  runStarted,
  now,
}: {
  leads: readonly Lead[];
  runStarted: ReadonlyMap<string, string>;
  now: number;
}) {
  const t = useT();
  const [range, setRange] = useState<Range>(30);
  const perDay = useMemo(
    () => leadsPerDay(leads, runStarted, range, now),
    [leads, runStarted, range, now],
  );
  const total = perDay.reduce((n, d) => n + d.count, 0);
  const best = perDay.reduce((a, b) => (b.count > a.count ? b : a), perDay[0]!);
  return (
    <PanelSection
      title={t('charts.perDay.title')}
      tone="purple"
      className="dp-chart"
      controls={<RangeControl label={t('charts.perDay.range')} value={range} onChange={setRange} />}
    >
      <LineChart
        showTitle={false}
        bars={showAsBars(perDay)}
        title={t('charts.perDay.title')}
        summary={
          total === 0
            ? t('charts.perDay.none', { days: range })
            : t('charts.perDay.summary', {
                total: formatNumber(total),
                days: range,
                best: best.count,
                day: formatShortDay(best.day),
              })
        }
        points={perDay.map((d) => ({ label: formatShortDay(d.day), value: d.count }))}
        valueText={(n) => t('charts.leads', { count: formatNumber(n) })}
        columns={{ x: t('charts.col.day'), y: t('charts.col.leads') }}
      />
    </PanelSection>
  );
}

/**
 * Leads (or spend) by sector. Spend comes from the coverage totals, which are all-time, so in Cost
 * mode the range does not apply and the summary says so.
 */
export function BySectorSection({
  leads,
  runStarted,
  coverage,
  regionId,
  now,
}: {
  leads: readonly Lead[];
  runStarted: ReadonlyMap<string, string>;
  coverage: Coverage | null;
  regionId: string;
  now: number;
}) {
  const t = useT();
  const [range, setRange] = useState<Range>(30);
  const [measure, setMeasure] = useState<Measure>('leads');
  const names = useMemo(
    () => new Map((coverage?.sectors ?? []).map((s) => [s.id, s.name])),
    [coverage],
  );
  const bars = useMemo(() => {
    const name = (id: string | null) =>
      id === null ? t('charts.sector.other') : (names.get(id) ?? id);
    if (measure === 'leads') {
      return leadsBySector(leads, runStarted, range, now).map((s) => ({
        key: s.sectorId ?? '_none',
        label: name(s.sectorId),
        value: s.count,
      }));
    }
    const spend = new Map<string | null, number>();
    for (const e of coverage?.entries ?? []) {
      if (regionId !== '' && e.regionId !== regionId) continue;
      spend.set(e.sectorId, (spend.get(e.sectorId) ?? 0) + e.spendUsd);
    }
    return [...spend]
      .filter(([, usd]) => usd > 0)
      .map(([id, usd]) => ({ key: id ?? '_none', label: name(id), value: usd }))
      .sort((a, b) => b.value - a.value);
  }, [measure, leads, runStarted, range, now, coverage, regionId, names, t]);
  const barTotal = bars.reduce((n, b) => n + b.value, 0);
  const title = t(measure === 'leads' ? 'charts.bySector.leads' : 'charts.bySector.cost');
  return (
    <PanelSection
      title={title}
      tone="orange"
      className="dp-chart"
      controls={
        <>
          <RangeControl label={t('charts.bySector.range')} value={range} onChange={setRange} />
          <ToggleGroup
            label={t('charts.measure')}
            hideLabel
            value={measure}
            options={[
              { value: 'leads', label: t('charts.measure.leads') },
              { value: 'cost', label: t('charts.measure.cost') },
            ]}
            onChange={setMeasure}
          />
        </>
      }
    >
      <BarChart
        showTitle={false}
        title={title}
        summary={
          measure === 'leads'
            ? t('charts.bySector.leadsSummary', { total: formatNumber(barTotal), days: range })
            : t('charts.bySector.costSummary', { total: formatUsd(barTotal) })
        }
        bars={bars}
        valueText={
          measure === 'leads' ? (n) => t('charts.leads', { count: formatNumber(n) }) : formatUsd
        }
        emptyText={t(measure === 'leads' ? 'charts.bySector.none' : 'charts.bySector.noCost')}
        columns={{
          x: t('charts.col.sector'),
          y: t(measure === 'leads' ? 'charts.col.leads' : 'charts.col.cost'),
        }}
      />
    </PanelSection>
  );
}
