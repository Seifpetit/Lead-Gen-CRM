import type { CountryCode } from '@lead-gen-crm/shared';

/**
 * The regions of each country other than Tunisia (Tunisia's 24 governorates are in regions.ts),
 * and which geoBoundaries file and which name in it each one is cut from. `npm run regions:build
 * -- FR` rebuilds a country's outline file from its list.
 *
 * Ids start with the country: "fr-bretagne". Tunisia's ids stay as they were ("sfax"), because
 * everything already stored points at them.
 */
export interface CountryRegion {
  id: string;
  name: string;
  nameFr: string;
  /** The region's name in the geoBoundaries file. */
  shapeName: string;
}

export interface CountryRegionSet {
  country: Exclude<CountryCode, 'TN'>;
  /** geoBoundaries' ISO code and the layer that holds the regions: ADM1 for France and Germany, ADM2 for Italy (its ADM1 is 5 macro-areas). */
  iso3: string;
  layer: 'ADM1' | 'ADM2';
  /** The file written to config/. */
  file: string;
  regions: readonly CountryRegion[];
}

const r = (id: string, name: string, nameFr: string, shapeName = name): CountryRegion => ({
  id,
  name,
  nameFr,
  shapeName,
});

export const FRANCE: CountryRegionSet = {
  country: 'FR',
  iso3: 'FRA',
  layer: 'ADM1',
  file: 'regionOutlines.fr.json',
  regions: [
    r('fr-ile-de-france', 'Île-de-France', 'Île-de-France'),
    r('fr-centre-val-de-loire', 'Centre-Val de Loire', 'Centre-Val de Loire'),
    r('fr-bourgogne-franche-comte', 'Bourgogne-Franche-Comté', 'Bourgogne-Franche-Comté'),
    r('fr-normandie', 'Normandy', 'Normandie', 'Normandie'),
    r('fr-hauts-de-france', 'Hauts-de-France', 'Hauts-de-France'),
    r('fr-grand-est', 'Grand Est', 'Grand Est'),
    r('fr-pays-de-la-loire', 'Pays de la Loire', 'Pays de la Loire'),
    r('fr-bretagne', 'Brittany', 'Bretagne', 'Bretagne'),
    r('fr-nouvelle-aquitaine', 'Nouvelle-Aquitaine', 'Nouvelle-Aquitaine'),
    r('fr-occitanie', 'Occitanie', 'Occitanie'),
    r('fr-auvergne-rhone-alpes', 'Auvergne-Rhône-Alpes', 'Auvergne-Rhône-Alpes'),
    r('fr-provence-alpes-cote-d-azur', "Provence-Alpes-Côte d'Azur", "Provence-Alpes-Côte d'Azur"),
    r('fr-corse', 'Corsica', 'Corse', 'Corse'),
  ],
};

export const GERMANY: CountryRegionSet = {
  country: 'DE',
  iso3: 'DEU',
  layer: 'ADM1',
  file: 'regionOutlines.de.json',
  regions: [
    r('de-baden-wurttemberg', 'Baden-Württemberg', 'Bade-Wurtemberg', 'Baden-Württemberg'),
    r('de-bayern', 'Bavaria', 'Bavière', 'Bayern'),
    r('de-berlin', 'Berlin', 'Berlin'),
    r('de-brandenburg', 'Brandenburg', 'Brandebourg', 'Brandenburg'),
    r('de-bremen', 'Bremen', 'Brême', 'Bremen'),
    r('de-hamburg', 'Hamburg', 'Hambourg', 'Hamburg'),
    r('de-hessen', 'Hesse', 'Hesse', 'Hessen'),
    r(
      'de-mecklenburg-vorpommern',
      'Mecklenburg-Western Pomerania',
      'Mecklembourg-Poméranie-Occidentale',
      'Mecklenburg-Vorpommern',
    ),
    r('de-niedersachsen', 'Lower Saxony', 'Basse-Saxe', 'Niedersachsen'),
    r(
      'de-nordrhein-westfalen',
      'North Rhine-Westphalia',
      'Rhénanie-du-Nord-Westphalie',
      'Nordrhein-Westfalen',
    ),
    r('de-rheinland-pfalz', 'Rhineland-Palatinate', 'Rhénanie-Palatinat', 'Rheinland-Pfalz'),
    r('de-saarland', 'Saarland', 'Sarre', 'Saarland'),
    r('de-sachsen', 'Saxony', 'Saxe', 'Sachsen'),
    r('de-sachsen-anhalt', 'Saxony-Anhalt', 'Saxe-Anhalt', 'Sachsen-Anhalt'),
    r('de-schleswig-holstein', 'Schleswig-Holstein', 'Schleswig-Holstein'),
    r('de-thuringen', 'Thuringia', 'Thuringe', 'Thüringen'),
  ],
};

export const ITALY: CountryRegionSet = {
  country: 'IT',
  iso3: 'ITA',
  layer: 'ADM2',
  file: 'regionOutlines.it.json',
  regions: [
    r('it-piemonte', 'Piedmont', 'Piémont', 'Piemonte'),
    r('it-valle-d-aosta', 'Aosta Valley', "Vallée d'Aoste", "Valle d'Aosta"),
    r('it-lombardia', 'Lombardy', 'Lombardie', 'Lombardia'),
    r('it-trentino-alto-adige', 'Trentino-Alto Adige', 'Trentin-Haut-Adige'),
    r('it-veneto', 'Veneto', 'Vénétie', 'Veneto'),
    r('it-friuli-venezia-giulia', 'Friuli Venezia Giulia', 'Frioul-Vénétie Julienne'),
    r('it-liguria', 'Liguria', 'Ligurie', 'Liguria'),
    r('it-emilia-romagna', 'Emilia-Romagna', 'Émilie-Romagne', 'Emilia-Romagna'),
    r('it-toscana', 'Tuscany', 'Toscane', 'Toscana'),
    r('it-umbria', 'Umbria', 'Ombrie', 'Umbria'),
    r('it-marche', 'Marche', 'Marches', 'Marche'),
    r('it-lazio', 'Lazio', 'Latium', 'Lazio'),
    r('it-abruzzo', 'Abruzzo', 'Abruzzes', 'Abruzzo'),
    r('it-molise', 'Molise', 'Molise'),
    r('it-campania', 'Campania', 'Campanie', 'Campania'),
    r('it-puglia', 'Apulia', 'Pouilles', 'Puglia'),
    r('it-basilicata', 'Basilicata', 'Basilicate', 'Basilicata'),
    r('it-calabria', 'Calabria', 'Calabre', 'Calabria'),
    r('it-sicilia', 'Sicily', 'Sicile', 'Sicilia'),
    r('it-sardegna', 'Sardinia', 'Sardaigne', 'Sardegna'),
  ],
};

export const COUNTRY_REGION_SETS: readonly CountryRegionSet[] = [FRANCE, GERMANY, ITALY];

export function regionSetOf(country: string): CountryRegionSet | undefined {
  return COUNTRY_REGION_SETS.find((s) => s.country === country);
}
