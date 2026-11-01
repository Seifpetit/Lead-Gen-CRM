import { useCountry } from './CountryContext.js';
import { CountryPicker } from './CountrySwitch.js';

/**
 * The country switch as a filter in a page's own header (the Dashboard). It is the same switch
 * as the sidebar's: choosing a country changes what the whole page shows.
 */
export function CountryFilter() {
  const { choice, countries, choose, allowsAll } = useCountry();
  return (
    <CountryPicker
      className="country-filter"
      choice={choice}
      countries={countries}
      allowsAll={allowsAll}
      onChoose={choose}
    />
  );
}
