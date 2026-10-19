import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { useT } from '../../../i18n/index.js';
import { METRICS, type Metric } from '../../../lib/coverageView.js';

/** Status | Leads | Cost | Yield: what the squares show and how they are coloured. */
export function MetricSwitch({
  metric,
  onChange,
}: {
  metric: Metric;
  onChange: (metric: Metric) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup
      label={t('cov.metric')}
      hideLabel
      value={metric}
      onChange={onChange}
      options={METRICS.map((m) => ({ value: m, label: t(`cov.metric.${m}`) }))}
    />
  );
}
