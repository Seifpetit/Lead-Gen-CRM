import { ApifyClient } from '../providers/apify.js';
import { EmailFinderVerifier, emailLookupKey } from '../providers/emailFinder.js';
import { GOOGLE_MAPS_ACTOR, GoogleMapsApifyDiscovery } from '../providers/googleMapsApify.js';
import {
  COMPANY_EMPLOYEES_ACTOR,
  CompanyEmployeesFinder,
  LinkedinPeopleFinder,
  PROFILE_SEARCH_ACTOR,
  ProfileSearchFinder,
} from '../providers/linkedin.js';
import { normalizeDomain } from '../lib/normalize.js';
import type { FoundEmail, FoundPerson, ProviderJob } from '../providers/types.js';
import {
  buildLeadCandidates,
  type CompanyForLead,
  type LeadCandidate,
  type PersonForLead,
} from '../stages/buildLeadCandidate.js';
import { matchTitle } from '../stages/matchTitle.js';
import { qualify, type Qualification } from '../stages/qualify.js';
import { score, type ScoreResult } from '../stages/score.js';
import { verifyCurrentRole } from '../stages/verifyCurrentRole.js';
import { FakeCompanyClassifier, FakeTitleClassifier } from './fakeClassifiers.js';
import { clock, fakeHttp, fixture } from './fixtures.js';

function items<T>(job: ProviderJob<T>): T[] {
  if (job.state !== 'succeeded') throw new Error(`fixture run not succeeded: ${job.state}`);
  return job.items;
}

export interface FixtureLead {
  candidate: LeadCandidate;
  score: ScoreResult;
}

export interface FixturePipelineResult {
  qualifications: { name: string; q: Qualification }[];
  leads: FixtureLead[];
}

/**
 * Runs the recorded fixtures through every pure stage, with fake classifiers and a fake HTTP
 * layer, the way the runner will in pass 4. No network, no database.
 */
export async function runFixturePipeline(): Promise<FixturePipelineResult> {
  const http = fakeHttp([
    [/actor-runs\/fixtureMapsRun001/, fixture('apify-run-maps.json')],
    [/datasets\/fixtureMapsDataset001/, fixture('maps-dataset.json')],
    [/actor-runs\/fixtureEmployeesRun001/, fixture('apify-run-employees.json')],
    [/datasets\/fixtureEmployeesDataset001/, fixture('employees-dataset.json')],
    [/actor-runs\/fixtureSearchRun001/, fixture('apify-run-profile-search.json')],
    [/datasets\/fixtureSearchDataset001/, fixture('profile-search-dataset.json')],
    [/actor-runs\/fixtureEmailRun001/, fixture('apify-run-emails.json')],
    [/datasets\/fixtureEmailDataset001/, fixture('emails-dataset.json')],
  ]);
  const client = new ApifyClient('apify_api_FAKE_TOKEN', http);
  const discovery = new GoogleMapsApifyDiscovery(client, clock);
  const people = new LinkedinPeopleFinder(
    new CompanyEmployeesFinder(client, clock),
    new ProfileSearchFinder(client, clock),
  );
  const emails = new EmailFinderVerifier(client, clock);
  const companyClassifier = new FakeCompanyClassifier({
    'Huilerie El Fixture': 'exporter',
    'Textiles Fixture Sud SARL': 'both',
    'Société Fixture Industries': 'trader',
  });
  const titleClassifier = new FakeTitleClassifier({ 'Directeur Commercial Export': null });

  const places = items(
    await discovery.collect({
      actorId: GOOGLE_MAPS_ACTOR,
      runId: 'fixtureMapsRun001',
      datasetId: 'fixtureMapsDataset001',
    }),
  );
  const employees = items(
    await people.collect({
      actorId: COMPANY_EMPLOYEES_ACTOR,
      runId: 'fixtureEmployeesRun001',
      datasetId: 'fixtureEmployeesDataset001',
    }),
  );
  const searched = items(
    await people.collect({
      actorId: PROFILE_SEARCH_ACTOR,
      runId: 'fixtureSearchRun001',
      datasetId: 'fixtureSearchDataset001',
    }),
  );
  const foundEmails = new Map(
    items(
      await emails.collect({
        actorId: 'crustapi/email-finder-verifier',
        runId: 'fixtureEmailRun001',
        datasetId: 'fixtureEmailDataset001',
      }),
    ).map((e) => [e.key, e] as const),
  );

  const qualifications: FixturePipelineResult['qualifications'] = [];
  const leads: FixtureLead[] = [];
  for (const place of places) {
    const q = await qualify(place, { classifier: companyClassifier });
    qualifications.push({ name: place.name.value, q });
    if (q.verdict !== 'qualified') continue;

    const company: CompanyForLead = { ...place, qualification: q };
    const identity = { name: place.name.value, linkedinUrl: place.linkedinUrl?.value ?? null };
    // Employees fixture for companies with a LinkedIn page, profile search otherwise.
    const found: FoundPerson[] = place.linkedinUrl ? employees : searched;
    const domain = place.website ? normalizeDomain(place.website.value) : null;
    const forLead: PersonForLead[] = [];
    for (const person of found) {
      const role = verifyCurrentRole(person.positions, identity);
      const title = await matchTitle(
        role.position?.title ?? person.headline?.value ?? '',
        titleClassifier,
      );
      let email: FoundEmail | null = null;
      if (domain && title.roleClass && role.current) {
        const [first, ...rest] = person.fullName.value.split(' ');
        email = foundEmails.get(emailLookupKey(first!, rest.join(' '), domain)) ?? null;
      }
      forLead.push({ person, title, role, email });
    }
    for (const candidate of buildLeadCandidates(company, forLead, { maxPeople: 3 })) {
      leads.push({ candidate, score: score(candidate) });
    }
  }
  return { qualifications, leads };
}
