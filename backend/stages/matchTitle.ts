import type { EvidenceKind, RoleClass } from '@lead-gen-crm/shared';
import { TITLE_DICTIONARY, normalizeTitle } from '../config/titles.js';
import type { CostEntry } from '../lib/cost.js';
import type { TitleClassifier } from './classifier.js';

export type Seniority = 'head' | 'manager' | 'staff';

export interface TitleMatch {
  roleClass: RoleClass | null;
  /** dictionary: an exact variant; keywords: a role word plus a seniority word; classifier. */
  method: 'dictionary' | 'keywords' | 'excluded' | 'classifier' | 'none';
  /** The dictionary variant or keywords that matched. */
  matched: string | null;
  seniority: Seniority | null;
  /** Dictionary and keyword matches are facts about the sourced title; classifier output is not. */
  kind: EvidenceKind;
  reasons: string[];
  costs: CostEntry[];
}

// Not decision-makers, whatever role they support.
const EXCLUDED = [
  'assistant',
  'assistante',
  'stagiaire',
  'stage',
  'intern',
  'internship',
  'trainee',
  'alternant',
  'alternante',
  'apprenti',
  'etudiant',
  'student',
];

// Role words for titles the dictionary doesn't list verbatim ("Logistics & Transport Manager").
const ROLE_KEYWORDS: Record<RoleClass, readonly string[]> = {
  supply_chain: ['supply chain', 'chaine logistique', 'chaine d approvisionnement'],
  logistics: ['logistique', 'logistics', 'entrepot', 'entrepots', 'warehouse', 'magasin central'],
  transport: [
    'transport',
    'transports',
    'flotte',
    'fleet',
    'parc',
    'expedition',
    'expeditions',
    'shipping',
    'freight',
    'affretement',
    'import export',
    'transit',
  ],
  purchasing: [
    'achat',
    'achats',
    'procurement',
    'purchasing',
    'approvisionnement',
    'approvisionnements',
    'sourcing',
  ],
  operations: ['operations', 'production', 'usine', 'plant', 'industriel'],
  general_manager: ['general', 'generale', 'executive'],
};

const HEAD_WORDS = [
  'directeur',
  'directrice',
  'director',
  'head',
  'vp',
  'vice president',
  'chief',
  'dg',
  'pdg',
  'ceo',
  'coo',
  'gerant',
  'gerante',
  'fondateur',
  'fondatrice',
  'founder',
  'owner',
  'proprietaire',
  'president',
];
const MANAGER_WORDS = ['responsable', 'manager', 'chef', 'lead', 'leader', 'country manager'];
const STAFF_WORDS = [
  'coordinateur',
  'coordinatrice',
  'coordinator',
  'gestionnaire',
  'supervisor',
  'superviseur',
  'acheteur',
  'acheteuse',
  'buyer',
  'planner',
  'approvisionneur',
  'logisticien',
  'logisticienne',
  'affreteur',
];

// Filler words that sit inside French and English titles ("responsable des achats",
// "head of logistics") and stop a dictionary phrase from matching as a whole.
const FILLER = new Set([
  'de',
  'des',
  'du',
  'la',
  'le',
  'les',
  'd',
  'l',
  'of',
  'the',
  'et',
  'and',
  'at',
]);

/** Drops filler words from an already-normalized title or phrase. */
const squash = (normalized: string) =>
  normalized
    .split(' ')
    .filter((t) => t !== '' && !FILLER.has(t))
    .join(' ');

const has = (padded: string, phrase: string) => padded.includes(` ${phrase} `);

function seniorityOf(padded: string): Seniority | null {
  if (HEAD_WORDS.some((w) => has(padded, w))) return 'head';
  if (MANAGER_WORDS.some((w) => has(padded, w))) return 'manager';
  if (STAFF_WORDS.some((w) => has(padded, w))) return 'staff';
  return null;
}

// Longest variant first, so "directeur general adjoint" wins over "directeur general".
const VARIANTS = (Object.entries(TITLE_DICTIONARY) as [RoleClass, readonly string[]][])
  .flatMap(([roleClass, variants]) => variants.map((v) => ({ roleClass, variant: squash(v) })))
  .sort((a, b) => b.variant.length - a.variant.length || a.variant.localeCompare(b.variant));

/** Dictionary and keyword rules only. Pure and synchronous. */
export function matchTitleByRules(title: string): TitleMatch {
  const padded = ` ${squash(normalizeTitle(title))} `;
  const base = { costs: [], kind: 'fact' as const };
  if (padded.trim() === '') {
    return {
      ...base,
      roleClass: null,
      method: 'none',
      matched: null,
      seniority: null,
      reasons: ['empty title'],
    };
  }
  const excluded = EXCLUDED.find((w) => has(padded, w));
  if (excluded) {
    return {
      ...base,
      roleClass: null,
      method: 'excluded',
      matched: excluded,
      seniority: null,
      reasons: [`"${excluded}" is not a decision-maker role`],
    };
  }
  const seniority = seniorityOf(padded);
  const hit = VARIANTS.find((v) => has(padded, v.variant));
  if (hit) {
    return {
      ...base,
      roleClass: hit.roleClass,
      method: 'dictionary',
      matched: hit.variant,
      seniority: seniority ?? 'manager',
      reasons: [`title contains "${hit.variant}"`],
    };
  }
  // Keyword rule needs a manager-or-above word, so "transport driver" doesn't match.
  if (seniority === 'head' || seniority === 'manager') {
    for (const [roleClass, words] of Object.entries(ROLE_KEYWORDS) as [
      RoleClass,
      readonly string[],
    ][]) {
      const word = words.map(squash).find((w) => has(padded, w));
      if (word) {
        return {
          ...base,
          roleClass,
          method: 'keywords',
          matched: word,
          seniority,
          reasons: [`title has role word "${word}" and a ${seniority}-level word`],
        };
      }
    }
  }
  return {
    ...base,
    roleClass: null,
    method: 'none',
    matched: null,
    seniority,
    reasons: ['no dictionary or keyword match'],
  };
}

/**
 * Dictionary first, then keywords; the classifier is called only when both miss (and never
 * for an excluded title). French and English titles go through the same normalization.
 */
export async function matchTitle(title: string, classifier?: TitleClassifier): Promise<TitleMatch> {
  const byRules = matchTitleByRules(title);
  if (byRules.method !== 'none' || !classifier || title.trim() === '') return byRules;
  const c = await classifier.classifyTitle(title);
  return {
    roleClass: c.verdict,
    method: 'classifier',
    matched: null,
    seniority: byRules.seniority,
    kind: 'estimate',
    reasons: [`${c.model}: ${c.reasons.join('; ') || 'no reason given'}`],
    costs: c.costs,
  };
}
