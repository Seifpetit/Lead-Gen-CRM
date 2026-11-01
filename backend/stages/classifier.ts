import type { RoleClass, TradeRole } from '@lead-gen-crm/shared';
import type { CostEntry } from '../lib/cost.js';

// Pluggable classifiers (an LLM in production, a fake in tests). Stages call them only when
// their rules can't decide, and label everything they return as an estimate.

/** A value the classifier relied on, with where it came from. */
export interface ClassifierEvidence {
  field: string;
  value: string;
  sourceUrl: string;
}

export interface Classification<V> {
  verdict: V;
  reasons: string[];
  evidence: ClassifierEvidence[];
  /** Model or implementation name, kept with the verdict for audit. */
  model: string;
  /** What the call cost; empty for a free or fake classifier. */
  costs: CostEntry[];
  /** For company classifiers: what the company does in international trade. */
  tradeRole?: TradeRole;
}

export type QualifyVerdict = 'qualified' | 'rejected' | 'review';

/** The facts about a company that a classifier may look at. */
export interface CompanyFacts {
  name: string;
  category: string | null;
  types: readonly string[];
  website: string | null;
  address: string | null;
  /** The sector whose search found the place, when known: the first sector candidate. */
  querySectorId?: string | null;
  sourceUrl: string;
  /**
   * own_trade (default): does the company import or export? trades_with_partner: does it trade
   * with `partnerCountry`?
   */
  mode?: 'own_trade' | 'trades_with_partner';
  partnerCountry?: string;
}

/** The trade role a classifier gave, as the pipeline verdict: traders qualify, the rest do not. */
export function verdictOfTradeRole(role: TradeRole): QualifyVerdict {
  if (role === 'unclear') return 'review';
  return TRADING.has(role) ? 'qualified' : 'rejected';
}

const TRADING: ReadonlySet<TradeRole> = new Set<TradeRole>([
  'exporter',
  'importer',
  'both',
  'trader',
]);

export interface CompanyClassifier {
  classifyCompany(facts: CompanyFacts): Promise<Classification<QualifyVerdict>>;
}

export interface TitleClassifier {
  /** Returns the role class for a title, or null when it isn't a decision-maker role. */
  classifyTitle(title: string): Promise<Classification<RoleClass | null>>;
}
