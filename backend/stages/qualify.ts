import type { EvidenceKind } from '@lead-gen-crm/shared';
import { CARRIER_KEYWORDS, FREIGHT_SECTORS } from '../config/sectors.js';
import type { CostEntry } from '../lib/cost.js';
import type { DiscoveredPlace } from '../providers/types.js';
import type {
  ClassifierEvidence,
  CompanyClassifier,
  CompanyFacts,
  QualifyVerdict,
} from './classifier.js';
import { findPhrase, padded } from './text.js';

export interface Qualification {
  verdict: QualifyVerdict;
  /** The freight sector the company was matched to, when known. */
  sectorId: string | null;
  method: 'rules' | 'classifier' | 'none';
  /** Rule verdicts are facts about the sourced name and category; classifier verdicts aren't. */
  kind: EvidenceKind;
  reasons: string[];
  evidence: ClassifierEvidence[];
  costs: CostEntry[];
}

// Places that receive goods in small amounts or don't ship them: not freight buyers.
const NON_SHIPPER_WORDS = [
  'restaurant',
  'cafe',
  'salon de the',
  'hotel',
  'lodging',
  'ecole',
  'school',
  'universite',
  'university',
  'hopital',
  'hospital',
  'clinique',
  'clinic',
  'doctor',
  'medecin',
  'dentiste',
  'dentist',
  'banque',
  'bank',
  'atm',
  'coiffure',
  'hair care',
  'beauty salon',
  'mosquee',
  'mosque',
  'church',
  'gym',
  'pharmacie',
  'pharmacy',
  'local government office',
  'gas station',
  'station service',
];

const evidenceOf = (place: DiscoveredPlace): ClassifierEvidence[] => [
  { field: 'name', value: place.name.value, sourceUrl: place.name.sourceUrl },
  ...(place.category
    ? [{ field: 'category', value: place.category.value, sourceUrl: place.category.sourceUrl }]
    : []),
];

/**
 * True when the company has some way to be contacted without a person: a phone number, a
 * website or an email. A place with none of the three can't become a lead, however well it
 * fits the sector, so it is kept as "unreachable" and sent no further.
 */
export function isReachable(place: DiscoveredPlace): boolean {
  return (
    place.phones.some((p) => p.value.trim() !== '') ||
    (place.website?.value.trim() ?? '') !== '' ||
    place.emails.some((e) => e.value.trim() !== '')
  );
}

/** Rules only; returns null when the rules can't decide. */
export function qualifyByRules(
  place: DiscoveredPlace,
  querySectorId: string | null = null,
): Qualification | null {
  const evidence = evidenceOf(place);
  const base = { method: 'rules' as const, kind: 'fact' as const, evidence, costs: [] };
  if (place.businessStatus === 'CLOSED_PERMANENTLY') {
    return { ...base, verdict: 'rejected', sectorId: null, reasons: ['permanently closed'] };
  }
  const nameAndCategory = padded(`${place.name.value} ${place.category?.value ?? ''}`);
  const withTypes = padded(
    `${place.name.value} ${place.category?.value ?? ''} ${place.types.join(' ').replace(/_/g, ' ')}`,
  );
  const carrier = findPhrase(nameAndCategory, CARRIER_KEYWORDS);
  if (carrier) {
    return {
      ...base,
      verdict: 'rejected',
      sectorId: null,
      reasons: [`looks like a freight carrier or forwarder ("${carrier}"), a competitor`],
    };
  }
  const nonShipper = findPhrase(withTypes, NON_SHIPPER_WORDS);
  if (nonShipper) {
    return {
      ...base,
      verdict: 'rejected',
      sectorId: null,
      reasons: [`not a freight buyer ("${nonShipper}")`],
    };
  }
  return matchSector(place, querySectorId, base);
}

/**
 * When the name matches the keywords of two sectors ("Poulina Textile Food"), the category
 * field decides: it is Google's own label for what the place is, where a name can be anything.
 * Order of preference: a sector the category matches, then the sector of the query that found
 * the place, then the config order.
 */
function matchSector(
  place: DiscoveredPlace,
  querySectorId: string | null,
  base: { method: 'rules'; kind: 'fact'; evidence: ClassifierEvidence[]; costs: never[] },
): Qualification | null {
  const inName = padded(place.name.value);
  const inCategory = padded(place.category?.value ?? '');
  const matches = FREIGHT_SECTORS.map((sector, order) => ({
    sector,
    order,
    byCategory: findPhrase(inCategory, sector.keywords),
    byName: findPhrase(inName, sector.keywords),
  })).filter((m) => m.byCategory || m.byName);
  if (matches.length === 0) return null;
  const rank = (m: (typeof matches)[number]) => [
    Number(!m.byCategory),
    Number(m.sector.id !== querySectorId),
    m.order,
  ];
  matches.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0]! - rb[0]! || ra[1]! - rb[1]! || ra[2]! - rb[2]!;
  });
  const [best, ...others] = matches;
  const word = best!.byCategory ?? best!.byName!;
  const where = best!.byCategory ? 'category' : 'name';
  const conflict =
    others.length > 0
      ? `; also matched ${others.map((o) => o.sector.name).join(', ')}, ${
          best!.byCategory ? 'but the category decides' : 'kept by the query sector or config order'
        }`
      : '';
  return {
    ...base,
    verdict: 'qualified',
    sectorId: best!.sector.id,
    reasons: [`${where} matches ${best!.sector.name} ("${word}")${conflict}`],
  };
}

/**
 * Rules first (closed, carrier, non-shipper, sector keyword); the classifier decides the
 * rest. With no classifier, undecided places go to manual review rather than being guessed.
 */
export async function qualify(
  place: DiscoveredPlace,
  options: {
    querySectorId?: string | null;
    classifier?: CompanyClassifier;
    /** Why a classifier that exists was not used (for example its spend cap); shown as the reason. */
    classifierSkipped?: string;
  } = {},
): Promise<Qualification> {
  const byRules = qualifyByRules(place, options.querySectorId ?? null);
  if (byRules) return byRules;
  if (!options.classifier) {
    return {
      verdict: 'review',
      sectorId: options.querySectorId ?? null,
      method: 'none',
      kind: 'estimate',
      reasons: [options.classifierSkipped ?? 'no rule matched and no classifier configured'],
      evidence: evidenceOf(place),
      costs: [],
    };
  }
  const facts: CompanyFacts = {
    name: place.name.value,
    category: place.category?.value ?? null,
    types: place.types,
    website: place.website?.value ?? null,
    address: place.address?.value ?? null,
    querySectorId: options.querySectorId ?? null,
    sourceUrl: place.name.sourceUrl,
  };
  const c = await options.classifier.classifyCompany(facts);
  return {
    verdict: c.verdict,
    sectorId: options.querySectorId ?? null,
    method: 'classifier',
    kind: 'estimate',
    reasons: c.reasons.map((r) => `${c.model}: ${r}`),
    evidence: c.evidence,
    costs: c.costs,
  };
}
