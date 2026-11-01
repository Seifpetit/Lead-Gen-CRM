import type {
  AddDecisionMakerResult,
  BulkRemoveResult,
  BulkRestoreResult,
  CardSelection,
  CountryCode,
  CountryInfo,
  MapPins,
  TradeCheckPreview,
  TradeCheckStatus,
  CompanyCardDetail,
  ApifyLog,
  BoardFilters,
  CardsQuery,
  AuthConfig,
  BudgetView,
  CostGroupBy,
  CostRow,
  CellSummary,
  Coverage,
  RegionGeometry,
  CrmBoard,
  CrmCard,
  CrmCardPage,
  CrmFacets,
  CrmPipeline,
  CrmStage,
  HealthProvider,
  HealthView,
  CsvDelimiter,
  DecisionMakerInput,
  ExportFormat,
  MessageTemplate,
  MessageTemplateInput,
  SenderProfile,
  Lead,
  LiveRuns,
  ObjectionResult,
  Page,
  RegionSuggestionView,
  RegionSummary,
  RunDetail,
  RunLogPage,
  RunPreview,
  RunPreviewInput,
  RunStatus,
  RunSummary,
  StartRunInput,
} from '@lead-gen-crm/shared';
import { ApiClient } from './client.js';

export interface SessionUser {
  id: string;
  email: string;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

/** What an export holds: the cards of a view, or the scored leads of runs. */
export type ExportSource =
  | { kind: 'cards'; pipeline: CrmPipeline; filters: CardsQuery }
  | {
      kind: 'leads';
      runIds: readonly string[];
      filters?: Pick<LeadQuery, 'stage' | 'regionId' | 'minScore' | 'q'>;
    };

export interface LeadQuery extends PageParams {
  stage?: CrmStage[];
  runId?: string;
  regionId?: string;
  minScore?: number;
  q?: string;
}

/**
 * Which country the screens are looking at. Every list that belongs to one country (leads,
 * boards, regions, coverage, the start-run form) sends it along; the country switch changes it.
 * Left undefined, nothing is filtered (this is how components work in tests without a switch).
 */
export interface CountryScope {
  country: CountryCode | undefined;
}

/** Typed calls for every endpoint the screens use. Paths and shapes mirror backend/routes. */
export function createApi(client: ApiClient) {
  const defined = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const scope: CountryScope = { country: undefined };
  /** Adds the country of the switch to a request, unless the call says "ALL" or names one. */
  const scoped = <T extends object>(params: T & { country?: CountryCode | 'ALL' | undefined }) => {
    const { country, ...rest } = params;
    const chosen = country === 'ALL' ? undefined : (country ?? scope.country);
    return defined({ ...rest, country: chosen });
  };

  return {
    client,
    scope,

    countries: {
      list: () => client.get<{ items: CountryInfo[] }>('/api/countries'),
    },

    auth: {
      config: () => client.get<AuthConfig>('/api/auth/config'),
      me: () => client.get<SessionUser>('/api/auth/me'),
      async login(email: string, password: string): Promise<void> {
        await client.request<void>('POST', '/api/auth/login', {
          body: { email, password },
          public: true,
        });
        client.resetSession();
      },
      async signup(email: string, password: string, inviteCode?: string): Promise<void> {
        await client.request<void>('POST', '/api/auth/signup', {
          body: defined({ email, password, inviteCode }),
          public: true,
        });
        client.resetSession();
      },
      async logout(): Promise<void> {
        await client.request<void>('POST', '/api/auth/logout', { public: true });
        client.resetSession();
      },
    },

    runs: {
      /** `country: 'ALL'` lists the runs of every country (the Runs page and the badge). */
      list: (params: PageParams & { status?: RunStatus[]; country?: CountryCode | 'ALL' } = {}) =>
        client.get<Page<RunSummary>>('/api/runs', scoped(params)),
      get: (id: string) => client.get<RunDetail>(`/api/runs/${id}`),
      preview: (input: RunPreviewInput) =>
        client.request<RunPreview>('POST', '/api/runs/preview', { body: input }),
      start: (input: StartRunInput) =>
        client.request<RunSummary>('POST', '/api/runs', { body: input }),
      stop: (id: string) => client.request<RunSummary>('POST', `/api/runs/${id}/stop`),
      /** Gives a run its next pass now and returns it with what the watchdog thinks of it. */
      recheck: (id: string) => client.request<RunSummary>('POST', `/api/runs/${id}/recheck`),
      /** The runs in progress; the polling fallback for the event stream. */
      live: () => client.get<LiveRuns>('/api/runs/live'),
      /** Where the event stream of the runs in progress lives. */
      streamUrl: () => client.url('/api/runs/stream'),
      /** A run's log lines after the given id, oldest first. */
      logs: (id: string, params: { after?: number; limit?: number } = {}) =>
        client.get<RunLogPage>(`/api/runs/${id}/logs`, defined(params)),
    },

    health: {
      get: () => client.get<HealthView>('/api/health'),
      /** "I fixed it": puts a provider back to ok; the next real call decides again. */
      resetProvider: (provider: HealthProvider) =>
        client.request<HealthView>('POST', `/api/health/providers/${provider}/reset`),
    },

    regions: {
      list: (params: PageParams & { country?: CountryCode | 'ALL' } = {}) =>
        client.get<Page<RegionSummary>>('/api/regions', scoped(params)),
      /** Every region's summary (all countries unless one is given), following the pages. */
      async all(params: { country?: CountryCode | 'ALL' } = {}): Promise<RegionSummary[]> {
        const all: RegionSummary[] = [];
        for (let offset: number | null = 0; offset !== null;) {
          const page: Page<RegionSummary> = await client.get<Page<RegionSummary>>(
            '/api/regions',
            scoped({ ...params, limit: 100, offset }),
          );
          all.push(...page.items);
          offset = page.nextOffset;
        }
        return all;
      },
      suggestion: () => client.get<RegionSuggestionView>('/api/regions/suggestion', scoped({})),
      /** `country: 'ALL'` asks for the regions of every country. */
      geometry: (params: { country?: CountryCode | 'ALL' } = {}) =>
        client.get<{ items: RegionGeometry[] }>('/api/regions/geometry', scoped(params)),
      /** All of a region's cells, following the pages. */
      async cells(regionId: string): Promise<CellSummary[]> {
        const all: CellSummary[] = [];
        for (let offset: number | null = 0; offset !== null;) {
          const page: Page<CellSummary> = await client.get<Page<CellSummary>>(
            `/api/regions/${regionId}/cells`,
            { limit: 100, offset },
          );
          all.push(...page.items);
          offset = page.nextOffset;
        }
        return all;
      },
    },

    coverage: {
      get: (params: { country?: CountryCode | 'ALL' } = {}) =>
        client.get<Coverage>('/api/coverage', scoped(params)),
    },

    map: {
      /** Every company with a place, for the Coverage map (all countries unless one is given). */
      pins: (params: { country?: CountryCode | 'ALL' } = {}) =>
        client.get<MapPins>('/api/map/pins', scoped(params)),
    },

    leads: {
      list: (query: LeadQuery = {}) => client.get<Page<Lead>>('/api/leads', scoped(query)),
      move: (id: string, stage: CrmStage, reason?: string) =>
        client.request<Lead>('PATCH', `/api/leads/${id}/stage`, {
          body: defined({ stage, reason }),
        }),
      objection: (id: string, reason: string) =>
        client.request<ObjectionResult>('POST', `/api/leads/${id}/objection`, {
          body: { reason },
        }),
    },

    crm: {
      board: (
        pipeline: CrmPipeline,
        filters: BoardFilters & { limit?: number | undefined } = {},
        signal?: AbortSignal,
      ) => client.get<CrmBoard>(`/api/crm/${pipeline}`, scoped(filters), signal),
      cards: (pipeline: CrmPipeline, query: CardsQuery = {}, signal?: AbortSignal) =>
        client.get<CrmCardPage>(`/api/crm/${pipeline}/cards`, scoped(query), signal),
      move: (id: string, stage: string, reason?: string) =>
        client.request<CrmCard>('POST', `/api/crm/cards/${id}/move`, {
          body: defined({ stage, reason }),
        }),
      addDecisionMaker: (id: string, input: DecisionMakerInput) =>
        client.request<AddDecisionMakerResult>('POST', `/api/crm/cards/${id}/decision-maker`, {
          body: input,
        }),
      facets: (
        pipeline: CrmPipeline,
        filters: Pick<BoardFilters, 'q' | 'minScore' | 'foundDays' | 'regionId' | 'trade'> = {},
        signal?: AbortSignal,
      ) => client.get<CrmFacets>(`/api/crm/${pipeline}/facets`, scoped(filters), signal),
      companyDetail: (companyId: string, signal?: AbortSignal) =>
        client.get<CompanyCardDetail>(`/api/crm/cards/by-company/${companyId}`, undefined, signal),
      saveNotes: (companyId: string, notes: string) =>
        client.request<{ notes: string }>('PATCH', `/api/crm/companies/${companyId}/notes`, {
          body: { notes },
        }),
      remove: (id: string) => client.request<CrmCard>('POST', `/api/crm/cards/${id}/remove`),
      selection: (pipeline: CrmPipeline, query: CardsQuery = {}, signal?: AbortSignal) =>
        client.get<CardSelection>(`/api/crm/${pipeline}/selection`, scoped(query), signal),
      removeMany: (ids: readonly string[]) =>
        client.request<BulkRemoveResult>('POST', '/api/crm/cards/bulk-remove', { body: { ids } }),
      restoreMany: (ids: readonly string[]) =>
        client.request<BulkRestoreResult>('POST', '/api/crm/cards/bulk-restore', {
          body: { ids },
        }),
      restore: (id: string, stage?: string) =>
        client.request<CrmCard>('POST', `/api/crm/cards/${id}/restore`, {
          body: defined({ stage }),
        }),
    },

    tradeCheck: {
      preview: () => client.get<TradeCheckPreview>('/api/trade-check/preview'),
      status: () => client.get<TradeCheckStatus>('/api/trade-check'),
      start: () => client.request<TradeCheckStatus>('POST', '/api/trade-check'),
      stop: () => client.request<TradeCheckStatus>('POST', '/api/trade-check/stop'),
    },

    costs: {
      by: (groupBy: CostGroupBy, params: PageParams = {}) =>
        client.get<Page<CostRow>>('/api/costs', { groupBy, ...defined(params) }),
      budget: () => client.get<BudgetView>('/api/costs/budget'),
      setCap: (capUsd: number) =>
        client.request<BudgetView>('PUT', '/api/costs/budget', { body: { capUsd } }),
    },

    exports: {
      download(source: ExportSource, format: ExportFormat, delimiter: CsvDelimiter = 'comma') {
        const options = { format, ...(format === 'csv' ? { delimiter } : {}) };
        if (source.kind === 'cards') {
          const { cursor: _c, limit: _l, ...filters } = source.filters;
          return client.download(`/api/exports/cards/${source.pipeline}`, {
            ...scoped(filters),
            ...options,
          });
        }
        return client.download('/api/exports/leads', {
          ...defined(source.filters ?? {}),
          runIds: [...source.runIds],
          ...options,
        });
      },
    },

    templates: {
      list: () => client.get<{ items: MessageTemplate[] }>('/api/templates'),
      create: (input: MessageTemplateInput) =>
        client.request<MessageTemplate>('POST', '/api/templates', { body: input }),
      update: (id: string, input: MessageTemplateInput) =>
        client.request<MessageTemplate>('PUT', `/api/templates/${id}`, { body: input }),
      remove: (id: string) => client.request<void>('DELETE', `/api/templates/${id}`),
    },

    profile: {
      sender: () => client.get<SenderProfile>('/api/profile/sender'),
      setSender: (profile: SenderProfile) =>
        client.request<SenderProfile>('PUT', '/api/profile/sender', { body: profile }),
    },

    contacts: {
      /** Notes that WhatsApp was opened for the company or its decision-maker. */
      record: (companyId: string, personId: string | null) =>
        client.request<{ at: string }>('POST', '/api/crm/contacts', {
          body: { channel: 'whatsapp', companyId, personId },
        }),
    },

    apify: {
      log: (params: { runs?: number; limit?: number } = {}) =>
        client.get<ApifyLog>('/api/apify/log', defined(params)),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
