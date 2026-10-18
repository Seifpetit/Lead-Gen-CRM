import type { RoleClass } from '@lead-gen-crm/shared';
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
}

export interface CompanyClassifier {
  classifyCompany(facts: CompanyFacts): Promise<Classification<QualifyVerdict>>;
}

export interface TitleClassifier {
  /** Returns the role class for a title, or null when it isn't a decision-maker role. */
  classifyTitle(title: string): Promise<Classification<RoleClass | null>>;
}
