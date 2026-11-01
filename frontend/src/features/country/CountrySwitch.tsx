import { Check, ChevronDown, Globe } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { useCountry, type CountryChoice } from './CountryContext.js';

/**
 * The country switch: a button showing the country, and a list under it. A country that is
 * switched off is greyed and says why. Choosing one changes the screens at once.
 */
export function CountrySwitch() {
  const t = useT();
  const { choice, countries, choose, allowsAll } = useCountry();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nameOf = (c: CountryChoice) =>
    c === 'ALL' ? t('country.all') : (countries.find((x) => x.code === c)?.name ?? c);
  const pick = (next: CountryChoice) => {
    choose(next);
    setOpen(false);
  };

  return (
    <div className="country-switch" ref={root}>
      <button
        type="button"
        className="country-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('country.switch', { name: nameOf(choice) })}
        title={t('country.label')}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={16} aria-hidden="true" />
        <span className="country-name nav-text">{nameOf(choice)}</span>
        <ChevronDown size={14} aria-hidden="true" className="nav-text" />
      </button>
      {open && (
        <ul id={id} className="country-menu" aria-label={t('country.label')}>
          {allowsAll && (
            <li>
              <button
                type="button"
                className="country-option"
                aria-pressed={choice === 'ALL'}
                onClick={() => pick('ALL')}
              >
                <span>{t('country.all')}</span>
                {choice === 'ALL' && <Check size={14} aria-hidden="true" />}
              </button>
            </li>
          )}
          {countries.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                className={`country-option${c.enabled ? '' : ' is-off'}`}
                aria-pressed={choice === c.code}
                aria-disabled={!c.enabled}
                disabled={!c.enabled}
                onClick={() => pick(c.code)}
              >
                <span>{c.name}</span>
                {choice === c.code && <Check size={14} aria-hidden="true" />}
                {!c.enabled && (
                  <span className="country-reason">
                    {t('country.off')}
                    {c.disabledReason ? `: ${c.disabledReason}` : ''}
                  </span>
                )}
                {c.enabled && c.unverified && (
                  <span className="country-reason">{t('country.draft')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
