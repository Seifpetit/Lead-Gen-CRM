import type { Db } from '../data/db.js';
import { Orchestrator } from '../runner/orchestrator.js';
import type { RunnerConfig } from '../runner/config.js';
import { FakeCompanyClassifier } from './fakeClassifiers.js';
import { fakeProviders, type FakeApifyOptions } from './fakeProviders.js';

/** An orchestrator wired to the fake Apify, for tests that need a runner but no spend. */
export function testRunner(
  db: Db,
  apify: FakeApifyOptions = {},
  config: Partial<RunnerConfig> = {},
) {
  const fake = fakeProviders(apify);
  const runner = new Orchestrator({
    db,
    discovery: fake.discovery,
    people: fake.people,
    emails: fake.emails,
    // Sector words no longer qualify a place by themselves; the classifier says it trades.
    companyClassifier: new FakeCompanyClassifier({}, { fallback: 'exporter', free: true }),
    config: { cellsPerRun: 2, ...config },
  });
  return { runner, ...fake };
}
