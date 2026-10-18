import type { Coverage, Lead } from '@lead-gen-crm/shared';
import { useMemo, useState } from 'react';
import { BarChart } from '../../components/shared/BarChart.js';
import { Card } from '../../components/shared/Card.js';
import { LineChart } from '../../components/shared/LineChart.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { useT } from '../../i18n/index.js';
import { formatNumber, formatShortDay, formatUsd } from '../../lib/format.js';
import { leadsBySector, leadsPerDay, RANGES, type Range } from './leadsView.js';

type Measure = 'leads' | 'cost';

/**
 * Two charts under one date-range selector: leads found per day, and leads (or spend) by
 * sector. Spend by sector comes from the coverage totals, which are all-time, so in Cost mode
 * the range does not apply and the chart says so.
 */
export function DashboardCharts({
  leads,
  runStarted,
  coverage,
  regionId,
  now,
}: {
  leads: readonly Lead[];
  runStarted: ReadonlyMap<string, string>;
  coverage: Coverage | null;
  /** When a region is picked, spend counts only that region. */
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
  const sectorName = (id: string | null) =>
    id === null ? t('charts.sector.other') : (names.get(id) ?? id);

  const perDay = useMemo(
    () => leadsPerDay(leads, runStarted, range, now),
    [leads, runStarted, range, now],
  );
  const total = perDay.reduce((n, d) => n + d.count, 0);
  const best = perDay.reduce((a, b) => (b.count > a.count ? b : a), perDay[0]!);

  const bars = useMemo(() => {
    if (measure === 'leads') {
      return leadsBySector(leads, runStarted, range, now).map((s) => ({
        key: s.sectorId ?? '_none',
        label: sectorName(s.sectorId),
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
      .map(([id, usd]) => ({ key: id ?? '_none', label: sectorName(id), value: usd }))
      .sort((a, b) => b.value - a.value);
    // sectorName only reads `names`, which is derived from coverage.
  }, [measure, leads, runStarted, range, now, coverage, regionId, names]);

  const barTotal = bars.reduce((n, b) => n + b.value, 0);
  const leadsText = (n: number) => t('charts.leads', { count: formatNumber(n) });

  return (
    <>
      <div className="range-row">
        <ToggleGroup
          label={t('charts.range')}
          value={String(range) as `${Range}`}
          options={RANGES.map((r) => ({
            value: String(r) as `${Range}`,
            label: t('charts.range.days', { days: r }),
          }))}
          onChange={(v) => setRange(Number(v) as Range)}
        />
      </div>
      <div className="chart-row">
        <Card title={t('charts.perDay.title')} className="chart-card">
          <LineChart
            showTitle={false}
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
            valueText={leadsText}
            columns={{ x: t('charts.col.day'), y: t('charts.col.leads') }}
          />
        </Card>
        <Card
          title={t(measure === 'leads' ? 'charts.bySector.leads' : 'charts.bySector.cost')}
          className="chart-card"
          actions={
            <ToggleGroup
              label={t('charts.measure')}
              value={measure}
              options={[
                { value: 'leads', label: t('charts.measure.leads') },
                { value: 'cost', label: t('charts.measure.cost') },
              ]}
              onChange={setMeasure}
            />
          }
        >
          <BarChart
            showTitle={false}
            title={t(measure === 'leads' ? 'charts.bySector.leads' : 'charts.bySector.cost')}
            summary={
              measure === 'leads'
                ? t('charts.bySector.leadsSummary', { total: formatNumber(barTotal), days: range })
                : t('charts.bySector.costSummary', { total: formatUsd(barTotal) })
            }
            bars={bars}
            valueText={measure === 'leads' ? leadsText : formatUsd}
            emptyText={t(measure === 'leads' ? 'charts.bySector.none' : 'charts.bySector.noCost')}
            columns={{
              x: t('charts.col.sector'),
              y: t(measure === 'leads' ? 'charts.col.leads' : 'charts.col.cost'),
            }}
          />
        </Card>
      </div>
    </>
  );
}
