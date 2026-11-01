import { DEV_LIMITS, type DevOptions, type DevStepInput } from '@lead-gen-crm/shared';
import { Plus, X } from 'lucide-react';
import { useId, useMemo } from 'react';
import { NumberStepper } from '../../components/shared/NumberStepper.js';
import { Select } from '../../components/shared/Select.js';
import { useT } from '../../i18n/index.js';
import { blankRow, classifyRequest, type ClassifyForm, type CompanyRow } from './devConsoleView.js';
import { StepRunner } from './StepRunner.js';

/** Classify: the import/export question, asked about up to 20 companies you list or carried over. */
export function ClassifyTab({
  options,
  form,
  onChange,
  busy,
  onRun,
}: {
  options: DevOptions;
  form: ClassifyForm;
  onChange: (form: ClassifyForm) => void;
  busy: boolean;
  onRun: (input: DevStepInput) => Promise<void>;
}) {
  const t = useT();
  const countryId = useId();
  const capId = useId();
  const request = useMemo(() => classifyRequest(form), [form]);
  const country = options.countries.find((c) => c.code === form.country);

  const setRow = (i: number, patch: Partial<CompanyRow>) =>
    onChange({
      ...form,
      rows: form.rows.map((r, at) => (at === i ? { ...r, ...patch } : r)),
    });

  return (
    <StepRunner
      step="classify"
      request={request}
      busy={busy}
      onRun={onRun}
      requestLabel={t('devc.question.label')}
    >
      <div className="dc-form">
        {!options.classifierConfigured && (
          <p className="form-error" role="alert">
            {t('devc.classify.noKey')}
          </p>
        )}
        <div className="dc-row">
          <div className="dc-field">
            <label htmlFor={countryId}>{t('devc.country')}</label>
            <Select
              id={countryId}
              value={form.country}
              onChange={(v) => onChange({ ...form, country: v as ClassifyForm['country'] })}
              options={options.countries.map((c) => ({ value: c.code, label: c.name }))}
            />
          </div>
          <div className="dc-field">
            <label htmlFor={capId}>{t('devc.cap')}</label>
            <NumberStepper
              id={capId}
              prefix="$"
              value={form.capUsd}
              onChange={(capUsd) => onChange({ ...form, capUsd })}
              min={0.01}
              max={DEV_LIMITS.classifyCapMaxUsd}
              step={0.05}
              decimals={2}
            />
          </div>
        </div>
        <p className="muted small">
          {t('devc.classify.mode', {
            country: country?.name ?? form.country,
            model: options.classifierModel,
          })}
        </p>

        <h3 className="dc-h">{t('devc.companies', { max: DEV_LIMITS.maxCompanies })}</h3>
        <ol className="dc-companies">
          {form.rows.map((row, i) => (
            <li key={i} className="dc-company">
              <label>
                {t('devc.company.name')}
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                />
              </label>
              <label>
                {t('devc.company.category')}
                <input
                  type="text"
                  value={row.category}
                  onChange={(e) => setRow(i, { category: e.target.value })}
                />
              </label>
              <label>
                {t('devc.company.website')}
                <input
                  type="text"
                  value={row.website}
                  onChange={(e) => setRow(i, { website: e.target.value })}
                />
              </label>
              <label>
                {t('devc.company.text')}
                <input
                  type="text"
                  value={row.text}
                  onChange={(e) => setRow(i, { text: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={t('devc.company.remove', { n: i + 1 })}
                onClick={() =>
                  onChange({
                    ...form,
                    rows:
                      form.rows.length > 1 ? form.rows.filter((_, at) => at !== i) : [blankRow()],
                  })
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button button-icon-text"
          disabled={form.rows.length >= DEV_LIMITS.maxCompanies}
          onClick={() => onChange({ ...form, rows: [...form.rows, blankRow()] })}
        >
          <Plus size={14} aria-hidden="true" />
          {t('devc.company.add')}
        </button>
      </div>
    </StepRunner>
  );
}
