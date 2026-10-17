/** The 24 governorates of Tunisia: the region list for the MVP. */
export const TUNISIAN_GOVERNORATES = [
  { id: 'tunis', name: 'Tunis', nameFr: 'Tunis' },
  { id: 'ariana', name: 'Ariana', nameFr: 'Ariana' },
  { id: 'ben-arous', name: 'Ben Arous', nameFr: 'Ben Arous' },
  { id: 'manouba', name: 'Manouba', nameFr: 'La Manouba' },
  { id: 'nabeul', name: 'Nabeul', nameFr: 'Nabeul' },
  { id: 'zaghouan', name: 'Zaghouan', nameFr: 'Zaghouan' },
  { id: 'bizerte', name: 'Bizerte', nameFr: 'Bizerte' },
  { id: 'beja', name: 'Beja', nameFr: 'Béja' },
  { id: 'jendouba', name: 'Jendouba', nameFr: 'Jendouba' },
  { id: 'kef', name: 'Kef', nameFr: 'Le Kef' },
  { id: 'siliana', name: 'Siliana', nameFr: 'Siliana' },
  { id: 'sousse', name: 'Sousse', nameFr: 'Sousse' },
  { id: 'monastir', name: 'Monastir', nameFr: 'Monastir' },
  { id: 'mahdia', name: 'Mahdia', nameFr: 'Mahdia' },
  { id: 'sfax', name: 'Sfax', nameFr: 'Sfax' },
  { id: 'kairouan', name: 'Kairouan', nameFr: 'Kairouan' },
  { id: 'kasserine', name: 'Kasserine', nameFr: 'Kasserine' },
  { id: 'sidi-bouzid', name: 'Sidi Bouzid', nameFr: 'Sidi Bouzid' },
  { id: 'gabes', name: 'Gabes', nameFr: 'Gabès' },
  { id: 'medenine', name: 'Medenine', nameFr: 'Médenine' },
  { id: 'tataouine', name: 'Tataouine', nameFr: 'Tataouine' },
  { id: 'gafsa', name: 'Gafsa', nameFr: 'Gafsa' },
  { id: 'tozeur', name: 'Tozeur', nameFr: 'Tozeur' },
  { id: 'kebili', name: 'Kebili', nameFr: 'Kébili' },
] as const;

export type GovernorateId = (typeof TUNISIAN_GOVERNORATES)[number]['id'];
