import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { anthropicPrice } from '../config/pricing.js';
import { HttpError } from '../httpClient.js';
import { totalUsd } from '../lib/cost.js';
import type { CompanyFacts } from '../stages/classifier.js';
import { AnthropicClassifier, createClassifier } from './anthropicClassifier.js';
import type { RequestOptions } from '../httpClient.js';
import type { HttpJson } from './http.js';

// The Claude classifier against a fake HTTP layer. No network, no key, no spend.

const KEY = 'sk-ant-test-key-do-not-log';
const FACTS: CompanyFacts = {
  name: 'Atelier Sfax Export',
  category: 'Atelier',
  types: ['store'],
  website: 'https://atelier.example.test',
  address: '12 rue des Tests, Sfax',
  querySectorId: 'textile',
  sourceUrl: 'https://maps.example.test/place/1',
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake HTTP layer that answers with `reply` and records what was sent. */
function fakeHttp(reply: unknown | (() => unknown)) {
  const sent: Sent[] = [];
  const http: HttpJson = async <T>(url: string, options: RequestOptions = {}) => {
    sent.push({
      url,
      headers: options.headers ?? {},
      body: options.body as Record<string, unknown>,
    });
    const r = typeof reply === 'function' ? (reply as () => unknown)() : reply;
    return r as T;
  };
  return { http, sent };
}

const message = (text: string, usage: unknown = { input_tokens: 400, output_tokens: 60 }) => ({
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text }],
  usage,
});

const classifier = (http: HttpJson) =>
  new AnthropicClassifier(KEY, { model: 'claude-haiku-5-5', http });

const ANSWER = (role: string, evidence = 'makes garments for export') =>
  JSON.stringify({ tradeRole: role, evidence, fields: ['name', 'category'] });

describe('company classification', () => {
  it('returns the trade role, one evidence sentence, the fields relied on, the model and the cost', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('exporter')));
    const c = await classifier(http).classifyCompany(FACTS);
    expect(c.verdict).toBe('qualified');
    expect(c.tradeRole).toBe('exporter');
    expect(c.reasons).toEqual(['makes garments for export']);
    expect(c.model).toBe('claude-haiku-5-5');
    expect(c.evidence).toEqual([
      { field: 'name', value: 'Atelier Sfax Export', sourceUrl: FACTS.sourceUrl },
      { field: 'category', value: 'Atelier', sourceUrl: FACTS.sourceUrl },
    ]);
    const price = anthropicPrice('claude-haiku-5-5');
    expect(c.costs.map((e) => [e.provider, e.item, e.units])).toEqual([
      ['anthropic', 'claude-haiku-5-5#input-tokens', 400],
      ['anthropic', 'claude-haiku-5-5#output-tokens', 60],
    ]);
    expect(totalUsd(c.costs)).toBeCloseTo((400 * price.input + 60 * price.output) / 1e6, 8);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['exporter', 'qualified'],
    ['importer', 'qualified'],
    ['both', 'qualified'],
    ['trader', 'qualified'],
    ['not_import_export', 'rejected'],
    ['competitor_or_partner', 'rejected'],
    ['unclear', 'review'],
  ])('turns the label %s into the pipeline verdict %s', async (role, verdict) => {
    const { http } = fakeHttp(message(ANSWER(role)));
    const c = await classifier(http).classifyCompany(FACTS);
    expect(c).toMatchObject({ tradeRole: role, verdict });
  });

  it('asks the import/export question, names every label and calls forwarders competitors', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('unclear')));
    await classifier(http).classifyCompany(FACTS);
    const system = String(sent[0]!.body.system);
    expect(system).toContain('regularly import or export physical goods');
    for (const label of [
      'exporter',
      'importer',
      'both',
      'trader',
      'not_import_export',
      'unclear',
      'competitor_or_partner',
    ]) {
      expect(system).toContain(`"${label}"`);
    }
    expect(system).toMatch(/freight forwarder.*customs broker|customs broker.*forwarder/is);
    expect(system).toMatch(/offshore/i);
    expect(system).toMatch(/never\s+invent/i);
  });

  it('asks about the partner country in trades_with_partner mode, with the same labels', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('importer')));
    const c = await classifier(http).classifyCompany({
      ...FACTS,
      mode: 'trades_with_partner',
      partnerCountry: 'TN',
    });
    const system = String(sent[0]!.body.system);
    expect(system).toContain('import physical goods from TN or export them to TN');
    expect(system).not.toContain('regularly import or export physical goods');
    expect(system).toContain('"competitor_or_partner"');
    expect(c.tradeRole).toBe('importer');
  });

  it('sends only public company facts, with the key in a header and no address', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('unclear')));
    await classifier(http).classifyCompany(FACTS);
    const call = sent[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBeTruthy();
    const body = JSON.stringify(call.body);
    expect(body).not.toContain(KEY);
    expect(body).not.toContain('rue des Tests');
    expect(body).toContain('Atelier Sfax Export');
    expect(body).toContain('atelier.example.test');
  });

  it('sends no sampling settings, which newer models reject with a 400', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('unclear')));
    await classifier(http).classifyCompany(FACTS);
    const keys = Object.keys(sent[0]!.body);
    for (const banned of ['temperature', 'top_p', 'top_k']) expect(keys).not.toContain(banned);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const { http } = fakeHttp(
      message('```json\n' + ANSWER('not_import_export', 'a shop') + '\n```'),
    );
    expect((await classifier(http).classifyCompany(FACTS)).verdict).toBe('rejected');
  });

  it('falls back to the name and category as evidence when none are named', async () => {
    const { http } = fakeHttp(message('{"tradeRole":"unclear","evidence":"thin"}'));
    const c = await classifier(http).classifyCompany(FACTS);
    expect(c.evidence.map((e) => e.field)).toEqual(['name', 'category']);
  });

  it.each([
    ['text that is not JSON', 'I think this is a textile company.'],
    ['a label outside the allowed seven', '{"tradeRole":"maybe","evidence":"x"}'],
    ['a missing evidence sentence', '{"tradeRole":"exporter"}'],
    ['the old verdict format', '{"verdict":"qualified","reasons":["x"]}'],
    ['an empty answer', ''],
  ])('answers review for %s, and still records what the call cost', async (_n, text) => {
    const { http } = fakeHttp(message(text));
    const c = await classifier(http).classifyCompany(FACTS);
    expect(c.verdict).toBe('review');
    expect(c.tradeRole).toBe('unclear');
    expect(c.reasons[0]).toContain('invalid answer');
    expect(c.evidence).toEqual([]);
    expect(totalUsd(c.costs)).toBeGreaterThan(0);
  });

  it('prices a call at a high guess, never zero, when usage is missing', async () => {
    const { http } = fakeHttp(message('{"verdict":"review","reasons":[]}', undefined));
    const c = await classifier(http).classifyCompany(FACTS);
    expect(totalUsd(c.costs)).toBeGreaterThan(0);
  });

  it('answers review on a timeout, with no cost', async () => {
    const { http } = fakeHttp(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const c = await classifier(http).classifyCompany(FACTS);
    expect(c.verdict).toBe('review');
    expect(c.reasons[0]).toContain('timeout');
    expect(c.costs).toEqual([]);
  });

  it('answers review on an HTTP error or a network failure, without echoing the error text', async () => {
    const server = fakeHttp(() => {
      throw new HttpError(529, 'https://api.anthropic.com/v1/messages');
    });
    const a = await classifier(server.http).classifyCompany(FACTS);
    expect(a.verdict).toBe('review');
    expect(a.reasons[0]).toContain('http 529');
    const down = fakeHttp(() => {
      throw new Error(`connect failed for ${KEY}`);
    });
    const b = await classifier(down.http).classifyCompany(FACTS);
    expect(b.verdict).toBe('review');
    expect(JSON.stringify(b)).not.toContain(KEY);
  });

  it('never returns qualified when anything goes wrong', async () => {
    const failures = [
      () => {
        throw new Error('boom');
      },
      () => ({}),
      () => ({ content: 'not blocks' }),
      () => message('{"verdict":"Qualified","reasons":[]}'),
    ];
    for (const f of failures) {
      const c = await classifier(fakeHttp(f).http).classifyCompany(FACTS);
      expect(c.verdict).toBe('review');
    }
  });
});

describe('title classification', () => {
  it('maps a role class, and none to null', async () => {
    const yes = fakeHttp(message('{"verdict":"logistics","reasons":["runs logistics"]}'));
    const a = await classifier(yes.http).classifyTitle('Chef de service expéditions');
    expect(a.verdict).toBe('logistics');
    expect(a.costs[0]!.provider).toBe('anthropic');
    const no = fakeHttp(message('{"verdict":"none","reasons":["sales"]}'));
    expect((await classifier(no.http).classifyTitle('Commercial')).verdict).toBeNull();
  });

  it('sends only the title', async () => {
    const { http, sent } = fakeHttp(message('{"verdict":"none","reasons":[]}'));
    await classifier(http).classifyTitle('Responsable transport');
    const user = (sent[0]!.body.messages as { content: string }[])[0]!.content;
    expect(JSON.parse(user)).toEqual({ title: 'Responsable transport' });
  });

  it('gives no role (so no lead) on invalid JSON, an unknown role or a timeout', async () => {
    for (const reply of [
      () => message('nope'),
      () => message('{"verdict":"ceo","reasons":[]}'),
      () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    ]) {
      const c = await classifier(fakeHttp(reply).http).classifyTitle('Directeur');
      expect(c.verdict).toBeNull();
    }
  });
});

describe('configuration', () => {
  const base = { APIFY_TOKEN: 'x', DATABASE_URL: 'postgres://u:p@localhost:5432/d' };

  it('has no classifier without a key, so rules decide alone', () => {
    const env = loadEnv(base);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(createClassifier(env)).toBeNull();
  });

  it('defaults to claude-haiku-5-5 and a $0.50 run cap, and reads overrides', () => {
    const env = loadEnv({ ...base, ANTHROPIC_API_KEY: KEY });
    expect(env.CLASSIFIER_MODEL).toBe('claude-haiku-5-5');
    expect(env.CLASSIFIER_RUN_CAP_USD).toBe(0.5);
    expect(createClassifier(env)).toBeInstanceOf(AnthropicClassifier);
    const custom = loadEnv({
      ...base,
      ANTHROPIC_API_KEY: KEY,
      CLASSIFIER_MODEL: 'claude-test',
      CLASSIFIER_RUN_CAP_USD: '0.1',
    });
    expect([custom.CLASSIFIER_MODEL, custom.CLASSIFIER_RUN_CAP_USD]).toEqual(['claude-test', 0.1]);
  });

  it('prices an unlisted model at the dearest known row, not zero', () => {
    expect(anthropicPrice('claude-unlisted').input).toBeGreaterThan(0);
  });
});

describe('company classification in a country that trades with Tunisia', () => {
  it('asks whether the company trades with Tunisia, naming the partner', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('importer')));
    await classifier(http).classifyCompany({
      ...FACTS,
      mode: 'trades_with_partner',
      partnerCountry: 'Tunisia',
    });
    const system = JSON.stringify(sent[0]!.body);
    expect(system).toContain('Tunisia');
    expect(system).toMatch(/import physical goods from Tunisia/);
  });

  it('keeps the original question for a company in its own country', async () => {
    const { http, sent } = fakeHttp(message(ANSWER('exporter')));
    await classifier(http).classifyCompany(FACTS);
    expect(JSON.stringify(sent[0]!.body)).not.toMatch(/from Tunisia or export/);
  });
});
