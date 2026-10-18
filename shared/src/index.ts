// Types shared by backend and frontend. Every stored value is traceable to a source.

export const EVIDENCE_KINDS = ['fact', 'estimate'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** One sourced value. Nothing is stored or shown without one. */
export interface Evidence {
  field: string;
  value: string;
  sourceUrl: string;
  /** ISO 8601 timestamp of when the source was read. */
  fetchedAt: string;
  kind: EvidenceKind;
}

export const ROLE_CLASSES = [
  'logistics',
  'transport',
  'supply_chain',
  'purchasing',
  'operations',
  'general_manager',
] as const;
export type RoleClass = (typeof ROLE_CLASSES)[number];

export interface Company {
  id: string;
  name: string;
  governorate: string;
  sector: string | null;
  googlePlaceId: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  /** The phone in E.164, when it is a usable number. */
  phoneE164?: string | null;
  /** True when the phone carries a country code other than +216: check it before calling. */
  phoneForeign?: boolean;
  email: string | null;
  linkedinUrl: string | null;
  evidence: Evidence[];
}

export interface Contact {
  id: string;
  companyId: string;
  fullName: string;
  title: string;
  roleClass: RoleClass | null;
  linkedinPublicId: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  /** True only when a position at the company has no end date. */
  currentRoleVerified: boolean;
  evidence: Evidence[];
}

export const CRM_STAGES = [
  'system_suggested',
  'confirmed',
  'contacted',
  'response',
  'dismissed',
  'won',
  'lost',
  'opted_out',
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export interface ScoreBreakdown {
  companyFit: number; // out of 50
  contactFit: number; // out of 30
  reachability: number; // out of 20
  total: number;
}

/** Why one block of score points was given, and what it rests on. */
export interface ScoreReason {
  component: 'companyFit' | 'contactFit' | 'reachability';
  points: number;
  reason: string;
  kind: EvidenceKind;
  evidence: { field: string; value: string; sourceUrl: string }[];
}

/** A decision-maker with a contact channel; the company is the fallback channel. */
export interface Lead {
  id: string;
  runId: string;
  company: Company;
  contact: Contact | null;
  score: ScoreBreakdown;
  /** The reasons behind the score points, as stored when the lead was scored. */
  scoreReasons?: ScoreReason[];
  crmStage: CrmStage;
}

export const RUN_STAGES = [
  'discover',
  'qualify',
  'find_people',
  'enrich',
  'verify',
  'score',
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const RUN_STATUSES = [
  'pending',
  'running',
  'finished',
  'failed',
  'cancelled',
  'stopped_by_cap',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ['normal', 'maintenance'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface Run {
  id: string;
  region: string;
  sectors: string[];
  /** Search only the extra wordings, no sector wordings (sectors is then empty). */
  customOnly: boolean;
  /** Extra search wordings typed in when the run was started. */
  customWordings: string[];
  /** Cells the run was restricted to; empty means the scheduler chose. */
  cellKeys: string[];
  /** normal: search for new places; maintenance: slow re-runs of a saturated region. */
  mode: RunMode;
  status: RunStatus;
  currentStage: RunStage | null;
  budgetCapUsd: number;
  spentUsd: number;
  /** Discovered places that fell outside the region's outline and were discarded before qualifying. */
  placesDroppedOutside: number;
  createdAt: string;
  finishedAt: string | null;
}

export * from './api.js';
