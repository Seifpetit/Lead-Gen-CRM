import type {
  AddDecisionMakerResult,
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

/** Typed calls for every endpoint the screens use. Paths and shapes mirror backend/routes. */
export function createApi(client: ApiClient) {
  const defined = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  return {
    client,

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
      list: (params: PageParams & { status?: RunStatus[] } = {}) =>
        client.get<Page<RunSummary>>('/api/runs', defined(params)),
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
      list: (params: PageParams = {}) =>
        client.get<Page<RegionSummary>>('/api/regions', defined(params)),
      suggestion: () => client.get<RegionSuggestionView>('/api/regions/suggestion'),
      geometry: () => client.get<{ items: RegionGeometry[] }>('/api/regions/geometry'),
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
      get: () => client.get<Coverage>('/api/coverage'),
    },

    leads: {
      list: (query: LeadQuery = {}) => client.get<Page<Lead>>('/api/leads', defined(query)),
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
      ) => client.get<CrmBoard>(`/api/crm/${pipeline}`, defined(filters), signal),
      cards: (pipeline: CrmPipeline, query: CardsQuery = {}, signal?: AbortSignal) =>
        client.get<CrmCardPage>(`/api/crm/${pipeline}/cards`, defined(query), signal),
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
        filters: Pick<BoardFilters, 'q' | 'minScore' | 'foundDays' | 'regionId'> = {},
        signal?: AbortSignal,
      ) => client.get<CrmFacets>(`/api/crm/${pipeline}/facets`, defined(filters), signal),
      companyDetail: (companyId: string, signal?: AbortSignal) =>
        client.get<CompanyCardDetail>(`/api/crm/cards/by-company/${companyId}`, undefined, signal),
      saveNotes: (companyId: string, notes: string) =>
        client.request<{ notes: string }>('PATCH', `/api/crm/companies/${companyId}/notes`, {
          body: { notes },
        }),
      remove: (id: string) => client.request<CrmCard>('POST', `/api/crm/cards/${id}/remove`),
      restore: (id: string, stage?: string) =>
        client.request<CrmCard>('POST', `/api/crm/cards/${id}/restore`, {
          body: defined({ stage }),
        }),
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
            ...defined(filters),
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
