import type { RegionSummary } from '@lead-gen-crm/shared';
import { ChipMultiSelect } from '../../../components/shared/ChipMultiSelect.js';
import { useT } from '../../../i18n/index.js';
import { regionProgress } from './startPlan.js';

/**
 * The regions to run one sector in, as chips with each region's coverage state beside its
 * name. A region with no map area cannot be searched, so its chip is off and stays off.
 */
export function RegionChips({
  regions,
  selected,
  onChange,
}: {
  regions: readonly RegionSummary[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  return (
    <ChipMultiSelect
      legend={t('start.regions')}
      items={regions.map((r) => ({
        id: r.regionId,
        label: r.name,
        hint: r.hasBounds ? t(`start.region.${regionProgress(r)}`) : t('start.region.noArea'),
        disabled: !r.hasBounds,
        ...(r.hasBounds ? {} : { title: t('start.region.noBounds', { name: r.name }) }),
      }))}
      selected={selected}
      onChange={onChange}
      countText={(n, total) => t('start.regions.count', { n, total })}
    />
  );
}
