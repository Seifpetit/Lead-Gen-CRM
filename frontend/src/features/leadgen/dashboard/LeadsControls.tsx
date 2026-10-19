import { Maximize2, SlidersHorizontal } from 'lucide-react';
import { Popover } from '../../../components/shared/Popover.js';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { useT } from '../../../i18n/index.js';
import { FOUND_WINDOWS, type FoundWindow, type LeadsQuery } from './leadsQuery.js';
import type { TileParts } from './LeadTile.js';

export type LeadsView = 'grid' | 'table';
const PART_KEYS = ['stage', 'score', 'found', 'contact'] as const;

/**
 * The controls of the Recent leads header: how far back "Found" reaches, Companies or People,
 * grid or table, what the cards show, and (in the panel) the button that expands it.
 */
export function LeadsControls({
  query,
  onQuery,
  view,
  onView,
  parts,
  onParts,
  onExpand,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  view: LeadsView;
  onView: (view: LeadsView) => void;
  parts: TileParts;
  onParts: (parts: TileParts) => void;
  /** Left out inside the expanded window, which is already expanded. */
  onExpand?: () => void;
}) {
  const t = useT();
  return (
    <>
      <ToggleGroup<FoundWindow>
        label={t('leads.found')}
        value={query.found}
        options={FOUND_WINDOWS.map((w) => ({ value: w, label: t(`leads.found.${w}`) }))}
        onChange={(found) => onQuery({ found })}
      />
      <ToggleGroup
        label={t('leads.pipeline')}
        hideLabel
        value={query.pipeline}
        options={[
          { value: 'companies', label: t('leads.pipeline.companies') },
          { value: 'people', label: t('leads.pipeline.people') },
        ]}
        // Another pipeline has other stages, so a stage choice does not carry over.
        onChange={(pipeline) => onQuery({ pipeline, stage: null })}
      />
      <ToggleGroup
        label={t('leads.view')}
        hideLabel
        value={view}
        options={[
          { value: 'grid', label: t('leads.view.grid') },
          { value: 'table', label: t('leads.view.table') },
        ]}
        onChange={onView}
      />
      <Popover
        label={t('leads.display')}
        icon={<SlidersHorizontal size={16} aria-hidden="true" />}
        portal
      >
        <fieldset className="popover-group">
          <legend>{t('leads.display.show')}</legend>
          {PART_KEYS.map((key) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={parts[key]}
                onChange={() => onParts({ ...parts, [key]: !parts[key] })}
              />
              {t(`leads.display.${key}`)}
            </label>
          ))}
        </fieldset>
      </Popover>
      {onExpand && (
        <button
          type="button"
          className="button button-icon"
          aria-label={t('leads.expand')}
          title={t('leads.expand')}
          onClick={onExpand}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
