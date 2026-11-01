/**
 * The countries the app can search, as data. Edit the words here; nothing else needs to change.
 *
 * Two kinds of country:
 * - own_trade: we look for companies of this country that import or export goods (Tunisia).
 * - trades_with_partner: we look for companies of this country that trade WITH the partner
 *   country (France, Germany and Italy trade with Tunisia). The map search words then name the
 *   partner ("huile d'olive Tunisie"), and the classifier is asked a different question.
 *
 * Only `enabled` countries can be picked for a run. A disabled country keeps its settings and
 * its map outline so it is ready, and the app shows why it is off.
 *
 * UNVERIFIED: every word list for a country other than Tunisia is a first draft written without
 * checking it against real Google Maps results. Treat the first run in a country as a test of
 * these words, and edit them here.
 */

import { COUNTRY_CODES, DEFAULT_COUNTRY, type CountryCode } from '@lead-gen-crm/shared';

export { COUNTRY_CODES, DEFAULT_COUNTRY, type CountryCode };

export type CountryMode = 'own_trade' | 'trades_with_partner';

export type LanguageCode = 'fr' | 'ar' | 'en' | 'de' | 'it';

export interface CountryConfig {
  code: CountryCode;
  /** English and French names, for the switch and the lists. */
  name: string;
  nameFr: string;
  mode: CountryMode;
  /** For trades_with_partner: the country the companies must trade with. */
  partnerCountry?: CountryCode;
  /** Only enabled countries can start runs. */
  enabled: boolean;
  /** Why a disabled country is off, shown next to it. */
  disabledReason?: string;
  /** The languages its listings are written in; the first one is the main search language. */
  languages: readonly LanguageCode[];
  /** Words that say a company trades across borders, per language. */
  tradeWords: Partial<Record<LanguageCode, readonly string[]>>;
  /** How the partner country is written in each language (used in the search words). */
  partnerNames?: Partial<Record<LanguageCode, string>>;
  /** Job-title words of the people to look for, per language. */
  roleKeywords: Partial<Record<LanguageCode, readonly string[]>>;
  /** True when the word lists above are a draft nobody has tried on real results yet. */
  unverified: boolean;
  /** EU country: the person shows a one-time data-protection notice before the first run. */
  gdprNotice: boolean;
  /** The dialling code, for phone numbers. */
  callingCode: string;
}

const TN_ROLES = [
  'responsable import export',
  'responsable export',
  'responsable import',
  'directeur export',
  'responsable achats',
  'responsable logistique',
  'directeur général',
  'export manager',
] as const;

export const COUNTRIES: Readonly<Record<CountryCode, CountryConfig>> = {
  TN: {
    code: 'TN',
    name: 'Tunisia',
    nameFr: 'Tunisie',
    mode: 'own_trade',
    enabled: true,
    languages: ['fr', 'ar', 'en'],
    // The Tunisian words live in config/sectors.ts (TRADE_WORDS and each sector's wordings).
    tradeWords: {},
    roleKeywords: { fr: TN_ROLES },
    unverified: false,
    gdprNotice: false,
    callingCode: '+216',
  },
  FR: {
    code: 'FR',
    name: 'France',
    nameFr: 'France',
    mode: 'trades_with_partner',
    partnerCountry: 'TN',
    enabled: true,
    languages: ['fr'],
    tradeWords: { fr: ['import export', 'importateur', 'exportateur', 'négoce'] },
    partnerNames: { fr: 'Tunisie' },
    roleKeywords: {
      fr: [
        'responsable achats',
        'directeur achats',
        'acheteur',
        'responsable approvisionnement',
        'responsable import',
        'directeur import export',
        'responsable logistique',
        'directeur général',
        'gérant',
      ],
      en: ['purchasing manager', 'import manager', 'sourcing manager', 'managing director'],
    },
    unverified: true,
    gdprNotice: true,
    callingCode: '+33',
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    nameFr: 'Allemagne',
    mode: 'trades_with_partner',
    partnerCountry: 'TN',
    enabled: false,
    disabledReason: 'Switched off until France has been tested and its search words are checked.',
    languages: ['de'],
    tradeWords: { de: ['Import Export', 'Importeur', 'Exporteur', 'Großhandel'] },
    partnerNames: { de: 'Tunesien' },
    roleKeywords: {
      de: [
        'Einkaufsleiter',
        'Leiter Einkauf',
        'Einkäufer',
        'Leiter Import',
        'Leiter Logistik',
        'Leiter Supply Chain',
        'Geschäftsführer',
        'Inhaber',
      ],
      en: ['purchasing manager', 'import manager', 'sourcing manager', 'managing director'],
    },
    unverified: true,
    gdprNotice: true,
    callingCode: '+49',
  },
  IT: {
    code: 'IT',
    name: 'Italy',
    nameFr: 'Italie',
    mode: 'trades_with_partner',
    partnerCountry: 'TN',
    enabled: false,
    disabledReason: 'Switched off until France has been tested and its search words are checked.',
    languages: ['it'],
    tradeWords: { it: ['import export', 'importatore', 'esportatore', 'commercio internazionale'] },
    partnerNames: { it: 'Tunisia' },
    roleKeywords: {
      it: [
        'responsabile acquisti',
        'direttore acquisti',
        'responsabile approvvigionamenti',
        'responsabile import',
        'responsabile logistica',
        'amministratore delegato',
        'titolare',
      ],
      en: ['purchasing manager', 'import manager', 'sourcing manager', 'managing director'],
    },
    unverified: true,
    gdprNotice: true,
    callingCode: '+39',
  },
};

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && (COUNTRY_CODES as readonly string[]).includes(value);
}

/** The country of a region or run; anything unknown counts as the default country. */
export function getCountry(code: string | null | undefined): CountryConfig {
  return isCountryCode(code) ? COUNTRIES[code] : COUNTRIES[DEFAULT_COUNTRY];
}

export function enabledCountries(): CountryConfig[] {
  return COUNTRY_CODES.map((c) => COUNTRIES[c]).filter((c) => c.enabled);
}

// ---------------------------------------------------------------------------------------
// Search words for a country that trades WITH the partner country.

/** The product of each sector, in each language (draft, see UNVERIFIED above). */
const PRODUCT_WORDS: Readonly<Record<string, Partial<Record<LanguageCode, string>>>> = {
  'olive-oil': { fr: "huile d'olive", de: 'Olivenöl', it: "olio d'oliva" },
  'dates-produce': { fr: 'dattes', de: 'Datteln', it: 'datteri' },
  textile: { fr: 'textile vêtements', de: 'Textilien Bekleidung', it: 'tessile abbigliamento' },
  'leather-shoes': { fr: 'cuir chaussures', de: 'Leder Schuhe', it: 'pelle scarpe' },
  'agri-food': { fr: 'produits alimentaires', de: 'Lebensmittel', it: 'prodotti alimentari' },
  seafood: { fr: 'produits de la mer', de: 'Meeresfrüchte', it: 'prodotti ittici' },
  'automotive-parts': {
    fr: 'composants automobiles',
    de: 'Autoteile Kabelbäume',
    it: 'componenti auto',
  },
  'plastics-packaging': {
    fr: 'plastique emballage',
    de: 'Kunststoff Verpackung',
    it: 'plastica imballaggi',
  },
  chemicals: { fr: 'produits chimiques', de: 'Chemikalien', it: 'prodotti chimici' },
  'construction-materials': {
    fr: 'matériaux de construction',
    de: 'Baumaterial',
    it: 'materiali da costruzione',
  },
  furniture: { fr: 'meubles', de: 'Möbel', it: 'mobili' },
};

/** The word for the buyer and for the seller, in each language. */
const WORDS_IMPORT: Partial<Record<LanguageCode, string>> = {
  fr: 'importateur',
  de: 'Importeur',
  it: 'importatore',
};
const WORDS_EXPORT: Partial<Record<LanguageCode, string>> = {
  fr: 'exportateur',
  de: 'Exporteur',
  it: 'esportatore',
};

/**
 * The map search words for one sector in a country that trades with a partner: the sector's
 * product, the partner's name and a trade word ("huile d'olive Tunisie importateur"). The
 * general sector uses the trade words alone with the partner's name. Null for a country that
 * searches its own trade (Tunisia): its words are in config/sectors.ts.
 */
export function partnerWordings(country: CountryConfig, sectorId: string): string[] | null {
  if (country.mode !== 'trades_with_partner') return null;
  const lang = country.languages[0]!;
  const partner = country.partnerNames?.[lang];
  if (!partner) return null;
  if (sectorId === 'import-export') {
    return (country.tradeWords[lang] ?? []).map((word) => `${word} ${partner}`);
  }
  const product = PRODUCT_WORDS[sectorId]?.[lang];
  if (!product) return [];
  const importer = WORDS_IMPORT[lang];
  const exporter = WORDS_EXPORT[lang];
  const out = [`${product} ${partner} ${importer ?? 'import'}`];
  if (exporter) out.push(`${product} ${partner} ${exporter}`);
  out.push(`${product} ${partner} import export`);
  return out;
}

/** Every job-title word to look for in a country, across its languages, without repeats. */
export function countryRoleKeywords(country: CountryConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const words of Object.values(country.roleKeywords)) {
    for (const w of words ?? []) {
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}
