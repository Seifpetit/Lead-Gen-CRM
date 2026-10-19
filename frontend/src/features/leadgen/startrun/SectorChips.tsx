import { ChipMultiSelect } from '../../../components/shared/ChipMultiSelect.js';
import { useT } from '../../../i18n/index.js';
import { sectorLook } from '../../crm/sectorLook.js';

/**
 * One toggle chip per sector, with the sector's icon and colour. Selected is filled with the
 * colour and ticks its box; unselected is an outline. The group is a ChipMultiSelect, so
 * dragging over chips paints them and Select all / Deselect all are there.
 */
export function SectorChips({
  sectors,
  selected,
  onChange,
}: {
  sectors: readonly { id: string; name: string }[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  return (
    <ChipMultiSelect
      legend={t('plan.sectors')}
      items={sectors.map((s) => {
        const { Icon, color } = sectorLook(s.id);
        return { id: s.id, label: s.name, color, icon: <Icon size={14} aria-hidden="true" /> };
      })}
      selected={selected}
      onChange={onChange}
      countText={(n, total) => t('plan.count', { n, total })}
      allLabel={t('plan.sectors.all')}
      noneLabel={t('plan.sectors.none')}
    />
  );
}
