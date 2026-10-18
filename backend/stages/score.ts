import type { EvidenceKind, ScoreBreakdown } from '@lead-gen-crm/shared';
import type { Sourced } from '../lib/sourced.js';
import type { LeadCandidate } from './buildLeadCandidate.js';

export type ScoreComponent = 'companyFit' | 'contactFit' | 'reachability';

export interface ScorePoint {
  component: ScoreComponent;
  points: number;
  reason: string;
  kind: EvidenceKind;
  /** The sourced values this point rests on. */
  evidence: { field: string; value: string; sourceUrl: string }[];
}

export interface ScoreResult extends ScoreBreakdown {
  factPoints: number;
  estimatePoints: number;
  points: ScorePoint[];
}

/** Maximum points per rule. Components sum to 50, 30 and 20. */
export const SCORE_WEIGHTS = {
  companyFit: {
    qualified: 20,
    sectorMatched: 10,
    operational: 5,
    ownWebsite: 5,
    sizeSignal: 10,
  },
  contactFit: {
    roleClass: 12,
    seniority: 8,
    currentRole: 10,
  },
  reachability: {
    personEmail: 12,
    personLinkedin: 3,
    companyPhone: 3,
    companyEmail: 2,
  },
} as const;

const ev = (field: string, s: Sourced<string>) => ({
  field,
  value: s.value,
  sourceUrl: s.sourceUrl,
});

/**
 * Company fit 50, contact fit 30, reachability 20. Every point names its reason, the
 * evidence behind it, and whether it rests on a fact or an estimate.
 */
export function score(candidate: LeadCandidate): ScoreResult {
  const w = SCORE_WEIGHTS;
  const points: ScorePoint[] = [];
  const add = (p: ScorePoint) => {
    if (p.points > 0) points.push(p);
  };
  const { company, person } = candidate;
  const q = company.qualification;
  const qEvidence = q.evidence.map((e) => ({ ...e }));

  // Company fit
  if (q.verdict === 'qualified') {
    add({
      component: 'companyFit',
      points: w.companyFit.qualified,
      reason: `qualified: ${q.reasons.join('; ')}`,
      kind: q.kind,
      evidence: qEvidence,
    });
  }
  if (q.verdict === 'qualified' && q.sectorId) {
    add({
      component: 'companyFit',
      points: w.companyFit.sectorMatched,
      reason: `freight sector ${q.sectorId}`,
      kind: q.kind,
      evidence: qEvidence,
    });
  }
  if (company.businessStatus === 'OPERATIONAL') {
    add({
      component: 'companyFit',
      points: w.companyFit.operational,
      reason: 'listed as operational',
      kind: 'fact',
      evidence: [ev('placeId', company.placeId)],
    });
  }
  if (company.website) {
    add({
      component: 'companyFit',
      points: w.companyFit.ownWebsite,
      reason: 'has its own website',
      kind: 'fact',
      evidence: [ev('website', company.website)],
    });
  }
  // Review count is a weak proxy for size: an estimate.
  const reviews = company.reviewsCount ?? 0;
  const sizePoints =
    reviews >= 20 ? w.companyFit.sizeSignal : reviews >= 5 ? w.companyFit.sizeSignal / 2 : 0;
  add({
    component: 'companyFit',
    points: sizePoints,
    reason: `${reviews} map reviews suggest an established site`,
    kind: 'estimate',
    evidence: [
      { field: 'reviewsCount', value: String(reviews), sourceUrl: company.placeId.sourceUrl },
    ],
  });

  // Contact fit
  if (person) {
    const t = person.titleMatch;
    const titleEv = person.title ? [ev('title', person.title)] : [];
    const rolePoints =
      person.roleClass === 'general_manager'
        ? w.contactFit.roleClass - 4
        : person.roleClass === 'purchasing' || person.roleClass === 'operations'
          ? w.contactFit.roleClass - 2
          : w.contactFit.roleClass;
    add({
      component: 'contactFit',
      points: rolePoints,
      reason: `role ${person.roleClass} (${t.method})`,
      kind: t.kind,
      evidence: titleEv,
    });
    const seniorityPoints =
      t.seniority === 'head'
        ? w.contactFit.seniority
        : t.seniority === 'manager'
          ? w.contactFit.seniority - 2
          : t.seniority === 'staff'
            ? w.contactFit.seniority - 5
            : 0;
    add({
      component: 'contactFit',
      points: seniorityPoints,
      reason: `seniority ${t.seniority ?? 'unknown'}`,
      kind: t.kind,
      evidence: titleEv,
    });
    if (person.role.current) {
      add({
        component: 'contactFit',
        points: w.contactFit.currentRole,
        reason: person.role.reason,
        kind: 'fact',
        evidence: [ev('linkedinUrl', person.linkedinUrl)],
      });
    }
  }

  // Reachability
  if (person?.email?.email) {
    const status = person.email.status;
    const emailPoints =
      status === 'valid'
        ? w.reachability.personEmail
        : status === 'catch_all'
          ? 5
          : status === 'unknown'
            ? 3
            : 0;
    // A found address is a pattern guess even when the mail server accepts it.
    add({
      component: 'reachability',
      points: emailPoints,
      reason: `personal email, verifier says ${status}`,
      kind: 'estimate',
      evidence: [ev('email', person.email.email)],
    });
  }
  if (person) {
    add({
      component: 'reachability',
      points: w.reachability.personLinkedin,
      reason: 'LinkedIn profile',
      kind: 'fact',
      evidence: [ev('linkedinUrl', person.linkedinUrl)],
    });
  }
  const cc = candidate.companyChannel;
  if (cc?.type === 'phone') {
    add({
      component: 'reachability',
      points: w.reachability.companyPhone,
      reason: `company ${cc.phoneLine ?? ''} phone`.replace('  ', ' '),
      kind: 'fact',
      evidence: [ev('phone', cc.value)],
    });
  }
  const companyEmail = company.emails[0];
  if (companyEmail) {
    add({
      component: 'reachability',
      points: w.reachability.companyEmail,
      reason: 'company email on its website',
      kind: 'fact',
      evidence: [ev('email', companyEmail)],
    });
  }

  const sum = (pred: (p: ScorePoint) => boolean) =>
    points.filter(pred).reduce((s, p) => s + p.points, 0);
  const companyFit = sum((p) => p.component === 'companyFit');
  const contactFit = sum((p) => p.component === 'contactFit');
  const reachability = sum((p) => p.component === 'reachability');
  return {
    companyFit,
    contactFit,
    reachability,
    total: companyFit + contactFit + reachability,
    factPoints: sum((p) => p.kind === 'fact'),
    estimatePoints: sum((p) => p.kind === 'estimate'),
    points,
  };
}
