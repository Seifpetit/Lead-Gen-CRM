import { DEV_LIMITS, type DevOptions, type DevStepInput } from '@lead-gen-crm/shared';
import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { NumberStepper } from '../../components/shared/NumberStepper.js';
import { Select } from '../../components/shared/Select.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { useT } from '../../i18n/index.js';
import {
  addWord,
  defaultArea,
  discoverRequest,
  languagesOf,
  type AreaKind,
  type DiscoverForm,
} from './devConsoleView.js';
import { StepRunner } from './StepRunner.js';

const AREA_KINDS: AreaKind[] = ['cell', 'region', 'rect'];

/** Discover: a Google Maps search in a cell, a whole region, or a rectangle you type in. */
export function DiscoverTab({
  options,
  form,
  onChange,
  busy,
  onRun,
}: {
  options: DevOptions;
  form: DiscoverForm;
  onChange: (form: DiscoverForm) => void;
  busy: boolean;
  onRun: (input: DevStepInput) => Promise<void>;
}) {
  const t = useT();
  const ids = {
    country: useId(),
    language: useId(),
    word: useId(),
    region: useId(),
    cell: useId(),
  };
  const placesId = useId();
  const capId = useId();
  const [typed, setTyped] = useState('');
  const request = useMemo(() => discoverRequest(form), [form]);
  const set = (patch: Partial<DiscoverForm>) => onChange({ ...form, ...patch });

  const regions = options.areas.filter((a) => a.country === form.country);
  const region = regions.find((r) => r.regionId === form.regionId);
  const languages = languagesOf(options, form.country);

  function pickCountry(code: string) {
    const country = code as DiscoverForm['country'];
    set({
      country,
      language: languagesOf(options, country)[0]!,
      ...defaultArea(options, country),
      areaKind: defaultArea(options, country).cellKey ? 'cell' : 'region',
    });
  }
  function pickRegion(regionId: string) {
    const next = regions.find((r) => r.regionId === regionId);
    set({ regionId, cellKey: next?.cells[0]?.cellKey ?? '' });
  }
  function add() {
    const next = addWord(form.words, typed);
    if (next) {
      set({ words: next });
      setTyped('');
    }
  }

  return (
    <StepRunner
      step="discover"
      request={request}
      busy={busy}
      onRun={onRun}
      requestLabel={t('devc.request.label')}
    >
      <div className="dc-form">
        <div className="dc-row">
          <div className="dc-field">
            <label htmlFor={ids.country}>{t('devc.country')}</label>
            <Select
              id={ids.country}
              value={form.country}
              onChange={pickCountry}
              options={options.countries.map((c) => ({ value: c.code, label: c.name }))}
            />
          </div>
          <div className="dc-field">
            <label htmlFor={ids.language}>{t('devc.language')}</label>
            <Select
              id={ids.language}
              value={form.language}
              onChange={(v) => set({ language: v as DiscoverForm['language'] })}
              options={languages.map((l) => ({ value: l, label: l.toUpperCase() }))}
            />
          </div>
        </div>

        <div className="dc-field">
          <label htmlFor={ids.word}>{t('devc.words', { max: DEV_LIMITS.maxWords })}</label>
          <div className="dc-words">
            {form.words.map((w) => (
              <span key={w} className="dc-chip">
                {w}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('devc.words.remove', { word: w })}
                  onClick={() => set({ words: form.words.filter((x) => x !== w) })}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="dc-add">
            <input
              id={ids.word}
              type="text"
              value={typed}
              maxLength={DEV_LIMITS.maxWordChars}
              disabled={form.words.length >= DEV_LIMITS.maxWords}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              className="button"
              disabled={form.words.length >= DEV_LIMITS.maxWords || typed.trim() === ''}
              onClick={add}
            >
              {t('devc.words.add')}
            </button>
          </div>
        </div>

        <ToggleGroup
          label={t('devc.area')}
          value={form.areaKind}
          onChange={(areaKind) => set({ areaKind })}
          options={AREA_KINDS.map((k) => ({ value: k, label: t(`devc.area.${k}` as const) }))}
        />

        {form.areaKind !== 'rect' && (
          <div className="dc-row">
            <div className="dc-field">
              <label htmlFor={ids.region}>{t('devc.region')}</label>
              <Select
                id={ids.region}
                value={form.regionId}
                onChange={pickRegion}
                options={regions.map((r) => ({ value: r.regionId, label: r.name }))}
              />
            </div>
            {form.areaKind === 'cell' && (
              <div className="dc-field">
                <label htmlFor={ids.cell}>{t('devc.cell')}</label>
                <Select
                  id={ids.cell}
                  value={form.cellKey}
                  onChange={(cellKey) => set({ cellKey })}
                  options={(region?.cells ?? []).map((c) => ({
                    value: c.cellKey,
                    label: c.cellKey,
                  }))}
                />
              </div>
            )}
          </div>
        )}
        {form.areaKind === 'cell' && region && region.cells.length === 0 && (
          <p className="muted small">{t('devc.cell.none')}</p>
        )}
        {form.areaKind === 'region' && <p className="muted small">{t('devc.region.note')}</p>}
        {form.areaKind === 'rect' && (
          <fieldset className="dc-rect">
            <legend>{t('devc.rect')}</legend>
            {(['south', 'west', 'north', 'east'] as const).map((side) => (
              <label key={side}>
                {t(`devc.rect.${side}` as const)}
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.rect[side]}
                  onChange={(e) => set({ rect: { ...form.rect, [side]: e.target.value } })}
                />
              </label>
            ))}
          </fieldset>
        )}

        <div className="dc-row">
          <div className="dc-field">
            <label htmlFor={placesId}>
              {t('devc.places', { max: DEV_LIMITS.maxPlacesPerSearch })}
            </label>
            <NumberStepper
              id={placesId}
              value={form.maxPlaces}
              onChange={(maxPlaces) => set({ maxPlaces })}
              min={1}
              max={DEV_LIMITS.maxPlacesPerSearch}
              step={1}
              decimals={0}
            />
          </div>
          <div className="dc-field">
            <label htmlFor={capId}>{t('devc.cap')}</label>
            <NumberStepper
              id={capId}
              prefix="$"
              value={form.capUsd}
              onChange={(capUsd) => set({ capUsd })}
              min={DEV_LIMITS.discoverCapMinUsd}
              max={DEV_LIMITS.discoverCapMaxUsd}
              step={0.05}
              decimals={2}
            />
          </div>
        </div>
        <p className="muted small">
          {t('devc.cap.note', { min: DEV_LIMITS.discoverCapMinUsd.toFixed(2) })}
        </p>
      </div>
    </StepRunner>
  );
}
