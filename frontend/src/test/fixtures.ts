import type {
  ApifyLog,
  Company,
  Contact,
  Evidence,
  Lead,
  Page,
  RegionSummary,
  RunDetail,
  RunFunnel,
  RunPreview,
  RunSummary,
  HealthView,
} from '@lead-gen-crm/shared';

// Synthetic data for tests: invented names and example.test URLs, never real contact details.

export const page = <T>(
  items: T[],
  total = items.length,
  nextOffset: number | null = null,
): Page<T> => ({
  items,
  total,
  limit: 50,
  offset: 0,
  nextOffset,
});

export const evidence = (
  field: string,
  value: string,
  kind: Evidence['kind'] = 'fact',
  sourceUrl = `https://source.example.test/${field}`,
): Evidence => ({ field, value, kind, sourceUrl, fetchedAt: '2026-10-18T09:30:00.000Z' });

export function company(over: Partial<Company> = {}): Company {
  return {
    id: 'co-1',
    name: 'Fixture Transport SARL',
    governorate: 'Sfax',
    sector: 'textile',
    googlePlaceId: 'place-1',
    domain: 'fixture-transport.example.test',
    website: 'https://fixture-transport.example.test',
    phone: '+216 70 000 000',
    email: null,
    linkedinUrl: null,
    evidence: [
      evidence('placeId', 'place-1', 'fact', 'https://maps.example.test/place/1'),
      evidence(
        'website',
        'https://fixture-transport.example.test',
        'fact',
        'https://maps.example.test/place/1',
      ),
      evidence('phone', '+216 70 000 000', 'fact', 'https://maps.example.test/place/1'),
    ],
    ...over,
  };
}

export function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'ct-1',
    companyId: 'co-1',
    fullName: 'Amel Fixture',
    title: 'Responsable logistique',
    roleClass: 'logistics',
    linkedinPublicId: 'amel-fixture',
    linkedinUrl: 'https://www.linkedin.com/in/amel-fixture',
    email: 'amel@fixture-transport.example.test',
    phone: null,
    currentRoleVerified: true,
    evidence: [
      evidence(
        'linkedinUrl',
        'https://www.linkedin.com/in/amel-fixture',
        'fact',
        'https://www.linkedin.com/in/amel-fixture',
      ),
      evidence(
        'title',
        'Responsable logistique',
        'fact',
        'https://www.linkedin.com/in/amel-fixture',
      ),
      evidence(
        'email',
        'amel@fixture-transport.example.test',
        'estimate',
        'https://finder.example.test/amel',
      ),
    ],
    ...over,
  };
}

export function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    runId: 'run-1',
    company: company(),
    contact: contact(),
    score: { companyFit: 40, contactFit: 25, reachability: 12, total: 77 },
    crmStage: 'system_suggested',
    ...over,
  };
}

export const funnel = (over: Partial<RunFunnel> = {}): RunFunnel => ({
  discovered: 40,
  skipped: 4,
  qualified: 12,
  rejected: 20,
  review: 4,
  unreachable: 3,
  peopleFound: 9,
  enriched: 8,
  scored: 8,
  leads: 6,
  ...over,
});

export function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    region: 'sfax',
    sectors: [],
    mode: 'normal',
    status: 'finished',
    currentStage: null,
    budgetCapUsd: 10,
    spentUsd: 3.21,
    placesDroppedOutside: 0,
    customOnly: false,
    customWordings: [],
    cellKeys: [],
    createdAt: '2026-10-18T09:00:00.000Z',
    finishedAt: '2026-10-18T09:20:00.000Z',
    funnel: funnel(),
    error: null,
    liveMessage: 'Done. 6 leads are ready.',
    stageFraction: 0,
    problem: null,
    ...over,
  };
}

export function runDetail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run(),
    steps: [{ stage: 'discover', pending: 0, inFlight: 0, finished: 4, failed: 0 }],
    leads: [lead()],
    leadsTotal: 1,
    ...over,
  };
}

export function region(over: Partial<RegionSummary> = {}): RegionSummary {
  return {
    regionId: 'sfax',
    name: 'Sfax',
    hasBounds: true,
    status: 'active',
    saturatedAt: null,
    cellsTotal: 8,
    cellsSearched: 2,
    cellsExhausted: 0,
    coverage: 0.25,
    queriesRun: 12,
    placesFound: 80,
    newPlacesPerQuery: 4.5,
    qualifiedShare: 0.15,
    decisionMakerShare: 0.5,
    channelShare: 0.7,
    spendUsd: 4.2,
    leads: 7,
    costPerLeadUsd: 0.6,
    runs: 2,
    lastRunAt: '2026-10-17T10:00:00.000Z',
    ...over,
  };
}

export function preview(over: Partial<RunPreview> = {}): RunPreview {
  return {
    regionId: 'sfax',
    mode: 'normal',
    cells: [{ cellKey: 'r0c0', reason: 'least searched' }],
    queries: [
      { wording: 'transport marchandises', sectorId: 'road-freight', cellKey: 'r0c0' },
      { wording: 'import export', sectorId: 'import-export', cellKey: 'r0c0' },
    ],
    queriesTotal: 2,
    sectors: [
      { id: 'road-freight', name: 'Road freight', wordings: ['transport marchandises'] },
      { id: 'import-export', name: 'Import and export', wordings: ['import export'] },
    ],
    volume: {
      placesMax: 300,
      places: 150,
      newPlaces: 150,
      qualified: 18,
      people: 9,
      leads: 6,
      kind: 'estimate',
    },
    cost: {
      discoverUsd: 1.5,
      findPeopleUsd: 1.8,
      enrichUsd: 0.2,
      totalUsd: 3.5,
      perLeadUsd: 0.58,
      upperBoundUsd: 3,
      kind: 'estimate',
    },
    limits: {
      budgetCapUsd: null,
      monthCapUsd: 50,
      monthSpentUsd: 5,
      monthRemainingUsd: 45,
      activeRuns: 0,
      maxActiveRuns: 2,
      maxRunCapUsd: 50,
    },
    blockers: [],
    assumptions: ['Each query returns about half its maximum places (no history yet)'],
    ...over,
  };
}

export const emptyApifyLog = (): ApifyLog => ({
  runs: [],
  attention: [],
  recent: page([]),
});

export const suggestion = {
  regionId: 'sfax',
  mode: 'normal',
  reason: 'Highest leads per dollar so far',
  widening: [],
  ranking: [],
};

export const budget = {
  month: '2026-10-01',
  capUsd: 50,
  spentUsd: 5,
  remainingUsd: 45,
};

/** Empty-but-valid answers for every read the Lead Gen and CRM pages make. */
export function dashboardRoutes(): Record<string, import('./fakeServer.js').Handler> {
  return {
    'GET /api/runs': page([]),
    'GET /api/runs/live': { runs: [] },
    'GET /api/regions': page([region(), region({ regionId: 'tunis', name: 'Tunis' })]),
    'GET /api/regions/suggestion': suggestion,
    'GET /api/apify/log': emptyApifyLog(),
    'GET /api/costs': page([]),
    'GET /api/costs/budget': budget,
    'GET /api/leads': page([]),
    'GET /api/crm/companies/cards': { cards: [], total: 0, nextCursor: null },
    'GET /api/crm/companies/facets': { total: 0, stages: [], sectors: [], runs: [] },
    'GET /api/crm/people/cards': { cards: [], total: 0, nextCursor: null },
    'GET /api/crm/people/facets': { total: 0, stages: [], sectors: [], runs: [] },
    'GET /api/coverage': { regions: [], sectors: [], entries: [] },
    'GET /api/regions/geometry': { items: [] },
  };
}

/** A healthy install: every provider ok, every check fine, nothing to report. */
export function health(over: Partial<HealthView> = {}): HealthView {
  return {
    providers: [
      { provider: 'apify', state: 'ok', kind: null, reason: null, since: null, lastOkAt: null },
      { provider: 'anthropic', state: 'ok', kind: null, reason: null, since: null, lastOkAt: null },
    ],
    errors: [],
    pendingMigrations: [],
    checks: [
      { id: 'apify_token', status: 'ok', message: 'The Apify key is set.' },
      { id: 'anthropic_key', status: 'ok', message: 'The Anthropic key is set.' },
      { id: 'database', status: 'ok', message: 'The database answers.' },
      { id: 'migrations', status: 'ok', message: 'The database is up to date.' },
    ],
    warnings: [],
    notices: [],
    checkedAt: '2026-10-19T12:00:00.000Z',
    ...over,
  };
}
