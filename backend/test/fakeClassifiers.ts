import { TRADE_ROLES, type RoleClass, type TradeRole } from '@lead-gen-crm/shared';
import { costEntry } from '../lib/cost.js';
import type {
  Classification,
  CompanyClassifier,
  CompanyFacts,
  QualifyVerdict,
  TitleClassifier,
} from '../stages/classifier.js';
import { verdictOfTradeRole } from '../stages/classifier.js';

const TRADE_ROLES_SET: ReadonlySet<string> = new Set(TRADE_ROLES);

/** Answers from a lookup table and records what it was asked. Charges a fake token cost. */
export class FakeCompanyClassifier implements CompanyClassifier {
  readonly calls: CompanyFacts[] = [];
  /** Answers by company name: a verdict, or a trade role (the verdict is then derived). */
  constructor(
    private readonly answers: Record<string, QualifyVerdict | TradeRole> = {},
    private readonly options: {
      /** What to answer for a name that is not in the table (default: review). */
      fallback?: QualifyVerdict | TradeRole;
      /** Charge nothing, for tests that count the ledger. */
      free?: boolean;
    } = {},
  ) {}

  async classifyCompany(facts: CompanyFacts): Promise<Classification<QualifyVerdict>> {
    this.calls.push(facts);
    const answer = this.answers[facts.name] ?? this.options.fallback ?? 'review';
    const tradeRole: TradeRole | undefined = (TRADE_ROLES_SET as ReadonlySet<string>).has(answer)
      ? (answer as TradeRole)
      : answer === 'qualified'
        ? 'trader'
        : answer === 'rejected'
          ? 'not_import_export'
          : 'unclear';
    const verdict = tradeRole ? verdictOfTradeRole(tradeRole) : 'review';
    return {
      verdict,
      tradeRole,
      reasons: [`fake verdict for ${facts.name}`],
      evidence: [{ field: 'name', value: facts.name, sourceUrl: facts.sourceUrl }],
      model: 'fake-classifier',
      costs: this.options.free ? [] : [costEntry('llm', 'fake-model-tokens', 1000, 0.000001)],
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
