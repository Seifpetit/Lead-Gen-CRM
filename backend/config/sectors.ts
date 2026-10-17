/**
 * Freight-relevant industries: companies that move goods and therefore buy transport.
 * searchTerms feed the Google Maps discovery stage (French first, as most listings are).
 */
export const FREIGHT_SECTORS = [
  {
    id: 'agri-food',
    name: 'Agri-food processing',
    searchTerms: ['industrie agroalimentaire', 'usine agroalimentaire', 'food factory'],
  },
  {
    id: 'olive-oil',
    name: 'Olive oil',
    searchTerms: ['huilerie', "huile d'olive export", 'olive oil mill'],
  },
  {
    id: 'dates-produce',
    name: 'Dates and fresh produce',
    searchTerms: [
      'conditionnement dattes',
      'station de conditionnement',
      'export fruits et legumes',
    ],
  },
  {
    id: 'textile',
    name: 'Textile and clothing',
    searchTerms: ['usine textile', 'confection', 'clothing manufacturer'],
  },
  {
    id: 'construction-materials',
    name: 'Construction materials',
    searchTerms: ['materiaux de construction', 'cimenterie', 'briqueterie', 'carrière'],
  },
  {
    id: 'steel-metal',
    name: 'Steel and metalwork',
    searchTerms: ['acierie', 'construction metallique', 'metal fabrication'],
  },
  {
    id: 'chemicals',
    name: 'Chemicals and fertilizers',
    searchTerms: ['industrie chimique', 'engrais', 'chemical plant'],
  },
  {
    id: 'plastics-packaging',
    name: 'Plastics, paper and packaging',
    searchTerms: ['plasturgie', 'emballage', 'cartonnerie', 'packaging manufacturer'],
  },
  {
    id: 'automotive-parts',
    name: 'Automotive and electrical components',
    searchTerms: ['cablage automobile', 'equipementier automobile', 'composants electriques'],
  },
  {
    id: 'pharma',
    name: 'Pharmaceuticals and medical supplies',
    searchTerms: [
      'laboratoire pharmaceutique',
      'industrie pharmaceutique',
      'grossiste medicaments',
    ],
  },
  {
    id: 'wholesale',
    name: 'Wholesale and distribution',
    searchTerms: ['grossiste', 'distributeur', 'centrale de distribution'],
  },
  {
    id: 'import-export',
    name: 'Import and export trading',
    searchTerms: ['import export', 'societe de commerce international', 'trading company'],
  },
  {
    id: 'retail-chains',
    name: 'Retail chains',
    searchTerms: ['hypermarche', 'grande distribution', 'chaine de magasins'],
  },
  {
    id: 'furniture',
    name: 'Furniture and wood',
    searchTerms: ['fabricant meubles', 'menuiserie industrielle', 'furniture factory'],
  },
  {
    id: 'mining',
    name: 'Mining and quarrying',
    searchTerms: ['phosphate', 'carriere', 'mining company'],
  },
] as const;

export type SectorId = (typeof FREIGHT_SECTORS)[number]['id'];
