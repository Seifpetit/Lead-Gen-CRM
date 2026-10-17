import type { RoleClass } from '@lead-gen-crm/shared';
import { costEntry } from '../lib/cost.js';
import type {
  Classification,
  CompanyClassifier,
  CompanyFacts,
  QualifyVerdict,
  TitleClassifier,
} from '../stages/classifier.js';

/** Answers from a lookup table and records what it was asked. Charges a fake token cost. */
export class FakeCompanyClassifier implements CompanyClassifier {
  readonly calls: CompanyFacts[] = [];
  constructor(private readonly answers: Record<string, QualifyVerdict> = {}) {}

  async classifyCompany(facts: CompanyFacts): Promise<Classification<QualifyVerdict>> {
    this.calls.push(facts);
    const verdict = this.answers[facts.name] ?? 'review';
    return {
      verdict,
      reasons: [`fake verdict for ${facts.name}`],
      evidence: [{ field: 'name', value: facts.name, sourceUrl: facts.sourceUrl }],
      model: 'fake-classifier',
      costs: [costEntry('llm', 'fake-model-tokens', 1000, 0.000001)],
    };
  }
}

export class FakeTitleClassifier implements TitleClassifier {
  readonly calls: string[] = [];
  constructor(private readonly answers: Record<string, RoleClass | null> = {}) {}

  async classifyTitle(title: string): Promise<Classification<RoleClass | null>> {
    this.calls.push(title);
    return {
      verdict: this.answers[title] ?? null,
      reasons: [`fake verdict for ${title}`],
      evidence: [],
      model: 'fake-classifier',
      costs: [costEntry('llm', 'fake-model-tokens', 500, 0.000001)],
    };
  }
}
