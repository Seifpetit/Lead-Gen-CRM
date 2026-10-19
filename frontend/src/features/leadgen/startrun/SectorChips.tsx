import { Check } from 'lucide-react';
import { useT } from '../../../i18n/index.js';
import { sectorLook } from '../../crm/sectorLook.js';

/**
 * One toggle chip per sector, with the sector's icon and colour. Selected is filled with the
 * colour and shows a check; unselected is an outline. Space or Enter toggles; the state is in
 * aria-pressed and the check, so it never rests on colour alone.
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
  const chosen = new Set(selected);
  const toggle = (id: string) =>
    onChange(sectors.map((s) => s.id).filter((x) => (x === id ? !chosen.has(x) : chosen.has(x))));

  return (
    <fieldset className="sr-sectors">
      <legend>{t('plan.sectors')}</legend>
      <div className="sr-sectors-bar">
        <span className="muted" role="status">
          {t('plan.count', { n: selected.length, total: sectors.length })}
        </span>
        <span className="sr-sectors-links">
          <button
            type="button"
            className="link-button"
            disabled={selected.length === sectors.length}
            onClick={() => onChange(sectors.map((s) => s.id))}
          >
            {t('plan.sectors.all')}
          </button>
          <button
            type="button"
            className="link-button"
            disabled={selected.length === 0}
            onClick={() => onChange([])}
          >
            {t('plan.sectors.none')}
          </button>
        </span>
      </div>
      <div className="sr-chips">
        {sectors.map((s) => {
          const { Icon, color } = sectorLook(s.id);
          const on = chosen.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className="sr-chip"
              data-sector={s.id}
              aria-pressed={on}
              style={on ? { background: color } : undefined}
              onClick={() => toggle(s.id)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{s.name}</span>
              {on && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
