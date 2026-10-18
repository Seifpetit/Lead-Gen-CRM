import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type Dictionary, type StringKey } from './en.js';

// Add 'fr' and 'ar' here (a Dictionary each) to ship another language. Arabic also needs
// dir="rtl" on <html>; DEFAULT_LOCALE decides what a visitor sees first.
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const dictionaries: Record<Locale, Dictionary> = { en };

export type Vars = Record<string, string | number>;
export type Translate = (key: StringKey, vars?: Vars) => string;

/** Looks a string up in a language and fills its {placeholders}. Unfilled ones stay visible. */
export function translate(locale: Locale, key: StringKey, vars?: Vars): string {
  const text = dictionaries[locale][key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale = DEFAULT_LOCALE,
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return useMemo(() => (key, vars) => translate(locale, key, vars), [locale]);
}

export type { StringKey };
