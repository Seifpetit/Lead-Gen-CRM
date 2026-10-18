import { beforeAll, describe, expect, it } from 'vitest';
import { blockNetwork } from '../test/fixtures.js';
import { runFixturePipeline, type FixturePipelineResult } from '../test/fixturePipeline.js';
import { SCORE_WEIGHTS } from './score.js';

let result: FixturePipelineResult;
beforeAll(async () => {
  blockNetwork();
  result = await runFixturePipeline();
});

const leadsFor = (company: string) =>
  result.leads.filter((l) => l.candidate.company.name.value === company);

describe('fixture pipeline: qualify, people, emails, lead candidates, score', () => {
  it('qualifies shippers and rejects carriers, restaurants and closed places', () => {
    expect(result.qualifications.map(({ name, q }) => [name, q.verdict, q.method])).toEqual([
      ['Huilerie El Fixture', 'qualified', 'rules'],
      ['Textiles Fixture Sud SARL', 'qualified', 'rules'],
      ['Trans-Fixture Logistique', 'rejected', 'rules'],
      ['Restaurant Le Fixture', 'rejected', 'rules'],
      ['Société Fixture Industries', 'qualified', 'classifier'],
      ['Cimenterie Fixture Fermée', 'rejected', 'rules'],
    ]);
  });

  it('picks current decision-makers, verified email first; skips ended, assistant and non-matching roles', () => {
    const leads = leadsFor('Huilerie El Fixture');
    expect(
      leads.map((l) => [l.candidate.person?.fullName.value, l.candidate.channel?.quality]),
    ).toEqual([
      ['Salma Fixture', 'verified'],
      ['Karim Testeur', 'catch_all'],
    ]);
    const skipped = Object.fromEntries(leads[0]!.candidate.skipped.map((s) => [s.name, s.reason]));
    expect(skipped['Nabil Ancien']).toBe(
      'not current at the company: position at this company ended 2024-06',
    );
    expect(skipped['Ines Assistante']).toMatch(/not a decision-maker/);
    expect(skipped['Mehdi Commercial']).toMatch(/not a decision-maker/);
  });

  it('never marks a contact with an end date as current', () => {
    for (const lead of result.leads) {
      const role = lead.candidate.person?.role;
      if (role?.current) expect(role.position?.endDate ?? null).toBeNull();
    }
    expect(result.leads.some((l) => l.candidate.person?.fullName.value === 'Nabil Ancien')).toBe(
      false,
    );
  });

  it('keeps the company channel as fallback, normalized to +216', () => {
    const [salma] = leadsFor('Huilerie El Fixture');
    expect(salma!.candidate.companyChannel).toMatchObject({
      type: 'phone',
      owner: 'company',
      quality: 'listed',
      phoneLine: 'landline',
      value: { value: '+21674000101', kind: 'fact' },
    });
  });

  it('uses profile search for a company with no LinkedIn page, LinkedIn as the channel when there is no email', () => {
    const [hela] = leadsFor('Textiles Fixture Sud SARL');
    expect(hela!.candidate).toMatchObject({
      kind: 'person',
      person: { fullName: { value: 'Héla Fixture' }, roleClass: 'general_manager' },
      channel: { type: 'linkedin', quality: 'listed' },
      companyChannel: { type: 'phone', phoneLine: 'mobile', value: { value: '+21698000202' } },
    });
    expect(hela!.candidate.person!.email).toBeNull();
  });

  it('builds a company-only candidate when no person is found', () => {
    const leads = leadsFor('Société Fixture Industries');
    expect(leads).toHaveLength(1);
    expect(leads[0]!.candidate).toMatchObject({
      kind: 'company_only',
      person: null,
      channel: { type: 'phone', owner: 'company' },
    });
    expect(leads[0]!.candidate.skipped.map((s) => s.name)).toEqual([
      'Héla Fixture',
      'Omar Ailleurs',
    ]);
  });

  it('scores 50 / 30 / 20 with every point tied to evidence and labelled fact or estimate', () => {
    const [salma, karim] = leadsFor('Huilerie El Fixture');
    expect(salma!.score).toMatchObject({
      companyFit: 50,
      contactFit: 30,
      reachability: 20,
      total: 100,
      estimatePoints: 22, // review-count size signal 10 + found email 12
      factPoints: 78,
    });
    // Catch-all scores lower than verified.
    expect(karim!.score.reachability).toBe(5 + 3 + 3 + 2);
    expect(karim!.score.contactFit).toBe(12 + 6 + 10);

    for (const { score } of result.leads) {
      expect(score.companyFit).toBeLessThanOrEqual(50);
      expect(score.contactFit).toBeLessThanOrEqual(30);
      expect(score.reachability).toBeLessThanOrEqual(20);
      expect(score.factPoints + score.estimatePoints).toBe(score.total);
      for (const p of score.points) {
        expect(p.evidence.length).toBeGreaterThan(0);
        for (const e of p.evidence) expect(e.sourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it('scores a classifier-qualified, company-only lead lower and mostly as estimate', () => {
    const [only] = leadsFor('Société Fixture Industries');
    expect(only!.score.contactFit).toBe(0);
    const qualifiedPoint = only!.score.points.find((p) => p.reason.startsWith('qualified'))!;
    expect(qualifiedPoint.kind).toBe('estimate');
    expect(only!.score.total).toBeLessThan(leadsFor('Huilerie El Fixture')[0]!.score.total);
  });

  it('weights add up to 50, 30 and 20', () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(SCORE_WEIGHTS.companyFit)).toBe(50);
    expect(sum(SCORE_WEIGHTS.contactFit)).toBe(30);
    expect(sum(SCORE_WEIGHTS.reachability)).toBe(20);
  });
});
