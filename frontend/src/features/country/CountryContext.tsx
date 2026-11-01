import { COUNTRY_CODES, type CountryCode, type CountryInfo } from '@lead-gen-crm/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { useApi } from '../../api/context.js';
import { useResource } from '../../lib/useResource.js';

/** What the switch can say: one country, or (on the boards only) all of them. */
export type CountryChoice = CountryCode | 'ALL';

const STORAGE_KEY = 'leadgen.country';
const DEFAULT_CHOICE: CountryCode = 'TN';

export interface CountryState {
  /** What the switch shows. */
  choice: CountryChoice;
  /** The country the screens ask for: the choice, or on a page without "all" the last real one. */
  country: CountryCode;
  /** True when the screens show every country (the boards with "All countries"). */
  showsAll: boolean;
  countries: readonly CountryInfo[];
  info: CountryInfo | undefined;
  choose: (choice: CountryChoice) => void;
  /** Is the switch able to say "All countries" on this page? */
  allowsAll: boolean;
}

const Context = createContext<CountryState | null>(null);

function isChoice(value: unknown): value is CountryChoice {
  return value === 'ALL' || (COUNTRY_CODES as readonly string[]).includes(value as string);
}

function readStored(): CountryChoice | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isChoice(v) ? v : null;
  } catch {
    return null;
  }
}

function store(choice: CountryChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}

/**
 * The country the person is working in. It is read from the address (?country=FR) first, then
 * from what this browser remembers, then Tunisia. Changing it changes what every list asks the
 * server for and re-draws the page; nothing reloads. "All countries" exists on the CRM boards
 * only: elsewhere it counts as the last real country.
 */
export function CountryProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const location = useLocation();
  const onBoards = location.pathname.startsWith('/crm');
  const list = useResource(() => api.countries.list());
  const countries = useMemo(() => list.data?.items ?? [], [list.data]);

  const [choice, setChoice] = useState<CountryChoice>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('country');
    return isChoice(fromUrl) ? fromUrl : (readStored() ?? DEFAULT_CHOICE);
  });
  const [lastCountry, setLastCountry] = useState<CountryCode>(() =>
    choice === 'ALL' ? DEFAULT_CHOICE : choice,
  );

  // A country that is switched off (or unknown) cannot be the choice: fall back to Tunisia.
  useEffect(() => {
    if (choice === 'ALL' || countries.length === 0) return;
    const info = countries.find((c) => c.code === choice);
    if (!info || !info.enabled) {
      setChoice(DEFAULT_CHOICE);
      setLastCountry(DEFAULT_CHOICE);
    }
  }, [choice, countries]);

  const showsAll = choice === 'ALL' && onBoards;
  const country: CountryCode = choice === 'ALL' ? lastCountry : choice;
  const effective: CountryCode | undefined = showsAll ? undefined : country;

  // The server calls read this at request time, so set it before the page below is drawn.
  api.scope.country = effective;

  // Keep the address in step, so a link carries the country. This edits the address bar only
  // (the router is not asked to navigate), so it can never fight a redirect in progress.
  const { pathname, search } = location;
  useEffect(() => {
    const shown = showsAll ? 'ALL' : country;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('country') === shown) return;
      url.searchParams.set('country', shown);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // No address bar to edit (a test, an embedded view); the switch still works.
    }
  }, [showsAll, country, pathname, search]);

  const choose = useCallback((next: CountryChoice) => {
    if (next !== 'ALL') setLastCountry(next);
    setChoice(next);
    store(next);
  }, []);

  const value = useMemo<CountryState>(
    () => ({
      choice: showsAll ? 'ALL' : country,
      country,
      showsAll,
      countries,
      info: countries.find((c) => c.code === country),
      choose,
      allowsAll: onBoards,
    }),
    [showsAll, country, countries, choose, onBoards],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCountry(): CountryState {
  const value = useContext(Context);
  if (!value) throw new Error('useCountry needs a CountryProvider');
  return value;
}
