/**
 * Sectors of companies that trade goods across borders (import/export), and the words searched
 * on the map for each. A search is "<product> <trade word>": the Google Maps cap of 60 results
 * per search means specific wordings find more than general ones.
 *
 * - searchTermsFr feed the query grid (most Tunisian listings are in French). Edit them here.
 * - searchTermsEn are kept for English listings and are not used by the grid by default.
 * - keywords are matched (accent-free, lowercase, whole words) against a place's name and
 *   category by the qualify stage, to give a company its sector.
 * - A sector with `active: false` is no longer searched; it stays so companies found earlier keep
 *   their sector name and keywords.
 */
export interface FreightSector {
  id: string;
  name: string;
  active: boolean;
  searchTermsFr: readonly string[];
  searchTermsEn: readonly string[];
  keywords: readonly string[];
}

/** Words that say a company trades across borders (FR / AR / EN). Searched on their own too. */
export const TRADE_WORDS = [
  'import export',
  "société d'import-export",
  'commerce international',
  'exportateur',
  'importateur',
  'négoce',
  'grossiste importateur',
  'مستورد',
  'مصدر',
  'تصدير وتوريد',
] as const;

/** The trade words put after a product: three are enough to find importers, exporters and both. */
const PRODUCT_TRADE_WORDS = ['exportateur', 'importateur', 'import export'] as const;
const withTradeWords = (product: string): string[] =>
  PRODUCT_TRADE_WORDS.map((word) => `${product} ${word}`);

export const FREIGHT_SECTORS = [
  {
    id: 'import-export',
    name: 'Import and export (general)',
    active: true,
    searchTermsFr: [...TRADE_WORDS],
    searchTermsEn: ['trading company', 'import export company'],
    keywords: [
      'import',
      'export',
      'importateur',
      'exportateur',
      'commerce international',
      'trading',
      'negoce',
    ],
  },
  {
    id: 'olive-oil',
    name: 'Olive oil',
    active: true,
    searchTermsFr: withTradeWords("huile d'olive"),
    searchTermsEn: ['olive oil exporter'],
    keywords: ['huilerie', 'huile', 'olive', 'oil'],
  },
  {
    id: 'dates-produce',
    name: 'Dates and fresh produce',
    active: true,
    searchTermsFr: withTradeWords('dattes'),
    searchTermsEn: ['dates exporter'],
    keywords: ['dattes', 'conditionnement', 'fruits', 'legumes', 'dates', 'produce'],
  },
  {
    id: 'textile',
    name: 'Textile and clothing',
    active: true,
    searchTermsFr: withTradeWords('textile confection'),
    searchTermsEn: ['clothing exporter'],
    keywords: ['textile', 'confection', 'bonneterie', 'clothing', 'garment', 'denim'],
  },
  {
    id: 'leather-shoes',
    name: 'Leather and shoes',
    active: true,
    searchTermsFr: withTradeWords('cuir chaussures'),
    searchTermsEn: ['leather goods exporter'],
    keywords: ['cuir', 'chaussures', 'maroquinerie', 'tannerie', 'leather', 'shoes', 'footwear'],
  },
  {
    id: 'agri-food',
    name: 'Agri-food',
    active: true,
    searchTermsFr: withTradeWords('agroalimentaire'),
    searchTermsEn: ['food exporter'],
    keywords: ['agroalimentaire', 'conserverie', 'conserve', 'food', 'biscuiterie', 'laiterie'],
  },
  {
    id: 'seafood',
    name: 'Fishing and seafood',
    active: true,
    searchTermsFr: withTradeWords('produits de la mer'),
    searchTermsEn: ['seafood exporter'],
    keywords: ['peche', 'poisson', 'produits de la mer', 'seafood', 'fish', 'thon'],
  },
  {
    id: 'automotive-parts',
    name: 'Mechanical and electrical components',
    active: true,
    searchTermsFr: withTradeWords('composants mécaniques électriques'),
    searchTermsEn: ['components exporter'],
    keywords: [
      'cablage',
      'equipementier',
      'composants',
      'automotive',
      'wiring',
      'mecanique',
      'electrique',
    ],
  },
  {
    id: 'plastics-packaging',
    name: 'Plastics and packaging',
    active: true,
    searchTermsFr: withTradeWords('plastique emballage'),
    searchTermsEn: ['packaging exporter'],
    keywords: ['plasturgie', 'plastique', 'emballage', 'cartonnerie', 'carton', 'packaging'],
  },
  {
    id: 'chemicals',
    name: 'Chemicals',
    active: true,
    searchTermsFr: withTradeWords('produits chimiques'),
    searchTermsEn: ['chemicals exporter'],
    keywords: ['chimique', 'chimie', 'engrais', 'chemical', 'fertilizer', 'detergent'],
  },
  {
    id: 'construction-materials',
    name: 'Building materials',
    active: true,
    searchTermsFr: withTradeWords('matériaux de construction'),
    searchTermsEn: ['building materials exporter'],
    keywords: ['materiaux', 'cimenterie', 'ciment', 'briqueterie', 'beton', 'cement'],
  },
  {
    id: 'furniture',
    name: 'Furniture',
    active: true,
    searchTermsFr: withTradeWords('meubles'),
    searchTermsEn: ['furniture exporter'],
    keywords: ['meubles', 'menuiserie', 'bois', 'furniture'],
  },
  // Earlier sectors, no longer searched: kept so companies found before keep their sector.
  {
    id: 'steel-metal',
    name: 'Steel and metalwork',
    active: false,
    searchTermsFr: [],
    searchTermsEn: [],
    keywords: ['acierie', 'metallique', 'metal', 'steel', 'tolerie', 'fonderie'],
  },
  {
    id: 'pharma',
    name: 'Pharmaceuticals and medical supplies',
    active: false,
    searchTermsFr: [],
    searchTermsEn: [],
    keywords: ['pharmaceutique', 'medicaments', 'pharma', 'pharmaceutical'],
  },
  {
    id: 'wholesale',
    name: 'Wholesale and distribution',
    active: false,
    searchTermsFr: [],
    searchTermsEn: [],
    keywords: ['grossiste', 'distributeur', 'distribution', 'wholesale', 'wholesaler'],
  },
  {
    id: 'retail-chains',
    name: 'Retail chains',
    active: false,
    searchTermsFr: [],
    searchTermsEn: [],
    keywords: ['hypermarche', 'supermarche', 'grande distribution', 'supermarket'],
  },
  {
    id: 'mining',
    name: 'Mining and quarrying',
    active: false,
    searchTermsFr: [],
    searchTermsEn: [],
    keywords: ['phosphate', 'carriere', 'mine', 'mining', 'quarry'],
  },
] as const satisfies readonly FreightSector[];

/** The sectors a run searches when none is named; retired sectors stay only to name old leads. */
export const ACTIVE_SECTORS: readonly FreightSector[] = FREIGHT_SECTORS.filter((s) => s.active);

export type SectorId = (typeof FREIGHT_SECTORS)[number]['id'];

/**
 * Freight carriers and forwarders: the user's competitors, never their customers.
 * The qualify stage rejects a place whose name or category matches one of these.
 */
export const CARRIER_KEYWORDS = [
  'transport de marchandises',
  'transporteur',
  'transports',
  'transitaire',
  'transit',
  'logistique',
  'messagerie',
  'demenagement',
  'freight',
  'logistics',
  'trucking',
  'forwarder',
  'courier',
  // German and Italian carriers and forwarders (for the countries that trade with Tunisia).
  'spedition',
  'spediteur',
  'logistik',
  'frachtfuhrer',
  'transportunternehmen',
  'fuhrunternehmen',
  'kurier',
  'spedizioni',
  'spedizioniere',
  'trasporti',
  'logistica',
  'corriere',
  'traslochi',
] as const;
