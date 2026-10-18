/**
 * Freight-relevant industries: companies that move goods and therefore buy transport.
 *
 * - searchTermsFr feed the query grid (most Tunisian listings are in French).
 * - searchTermsEn are kept for English listings and are not used by the grid by default.
 * - keywords are matched (accent-free, lowercase, whole words) against a place's name and
 *   category by the qualify stage.
 */
export interface FreightSector {
  id: string;
  name: string;
  searchTermsFr: readonly string[];
  searchTermsEn: readonly string[];
  keywords: readonly string[];
}

export const FREIGHT_SECTORS = [
  {
    id: 'agri-food',
    name: 'Agri-food processing',
    searchTermsFr: ['industrie agroalimentaire', 'usine agroalimentaire', 'conserverie'],
    searchTermsEn: ['food factory'],
    keywords: ['agroalimentaire', 'conserverie', 'conserve', 'food', 'biscuiterie', 'laiterie'],
  },
  {
    id: 'olive-oil',
    name: 'Olive oil',
    searchTermsFr: ['huilerie', "huile d'olive export"],
    searchTermsEn: ['olive oil mill'],
    keywords: ['huilerie', 'huile', 'olive', 'oil'],
  },
  {
    id: 'dates-produce',
    name: 'Dates and fresh produce',
    searchTermsFr: [
      'conditionnement dattes',
      'station de conditionnement',
      'export fruits et légumes',
    ],
    searchTermsEn: ['dates exporter'],
    keywords: ['dattes', 'conditionnement', 'fruits', 'legumes', 'dates', 'produce'],
  },
  {
    id: 'textile',
    name: 'Textile and clothing',
    searchTermsFr: ['usine textile', 'confection'],
    searchTermsEn: ['clothing manufacturer'],
    keywords: ['textile', 'confection', 'bonneterie', 'clothing', 'garment', 'denim'],
  },
  {
    id: 'construction-materials',
    name: 'Construction materials',
    searchTermsFr: ['matériaux de construction', 'cimenterie', 'briqueterie'],
    searchTermsEn: ['building materials supplier'],
    keywords: ['materiaux', 'cimenterie', 'ciment', 'briqueterie', 'beton', 'cement'],
  },
  {
    id: 'steel-metal',
    name: 'Steel and metalwork',
    searchTermsFr: ['aciérie', 'construction métallique'],
    searchTermsEn: ['metal fabrication'],
    keywords: ['acierie', 'metallique', 'metal', 'steel', 'tolerie', 'fonderie'],
  },
  {
    id: 'chemicals',
    name: 'Chemicals and fertilizers',
    searchTermsFr: ['industrie chimique', 'engrais'],
    searchTermsEn: ['chemical plant'],
    keywords: ['chimique', 'chimie', 'engrais', 'chemical', 'fertilizer', 'detergent'],
  },
  {
    id: 'plastics-packaging',
    name: 'Plastics, paper and packaging',
    searchTermsFr: ['plasturgie', 'emballage', 'cartonnerie'],
    searchTermsEn: ['packaging manufacturer'],
    keywords: ['plasturgie', 'plastique', 'emballage', 'cartonnerie', 'carton', 'packaging'],
  },
  {
    id: 'automotive-parts',
    name: 'Automotive and electrical components',
    searchTermsFr: ['câblage automobile', 'équipementier automobile', 'composants électriques'],
    searchTermsEn: ['automotive parts manufacturer'],
    keywords: ['cablage', 'equipementier', 'composants', 'automotive', 'wiring'],
  },
  {
    id: 'pharma',
    name: 'Pharmaceuticals and medical supplies',
    searchTermsFr: ['laboratoire pharmaceutique', 'grossiste médicaments'],
    searchTermsEn: ['pharmaceutical company'],
    keywords: ['pharmaceutique', 'medicaments', 'pharma', 'pharmaceutical'],
  },
  {
    id: 'wholesale',
    name: 'Wholesale and distribution',
    searchTermsFr: ['grossiste', 'distributeur', 'centrale de distribution'],
    searchTermsEn: ['wholesaler'],
    keywords: ['grossiste', 'distributeur', 'distribution', 'wholesale', 'wholesaler'],
  },
  {
    id: 'import-export',
    name: 'Import and export trading',
    searchTermsFr: ['import export', 'société de commerce international'],
    searchTermsEn: ['trading company'],
    keywords: ['import', 'export', 'commerce international', 'trading'],
  },
  {
    id: 'retail-chains',
    name: 'Retail chains',
    searchTermsFr: ['hypermarché', 'grande distribution'],
    searchTermsEn: ['supermarket chain'],
    keywords: ['hypermarche', 'supermarche', 'grande distribution', 'supermarket'],
  },
  {
    id: 'furniture',
    name: 'Furniture and wood',
    searchTermsFr: ['fabricant meubles', 'menuiserie industrielle'],
    searchTermsEn: ['furniture factory'],
    keywords: ['meubles', 'menuiserie', 'bois', 'furniture'],
  },
  {
    id: 'mining',
    name: 'Mining and quarrying',
    searchTermsFr: ['phosphate', 'carrière'],
    searchTermsEn: ['mining company'],
    keywords: ['phosphate', 'carriere', 'mine', 'mining', 'quarry'],
  },
] as const satisfies readonly FreightSector[];

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
] as const;
