import type {
  ApifyLog,
  AuthConfig,
  BudgetView,
  CostGroupBy,
  CostRow,
  CrmStage,
  Lead,
  ObjectionResult,
  Page,
  RegionSuggestionView,
  RegionSummary,
  RunDetail,
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
    },

    regions: {
      list: (params: PageParams = {}) =>
        client.get<Page<RegionSummary>>('/api/regions', defined(params)),
      suggestion: () => client.get<RegionSuggestionView>('/api/regions/suggestion'),
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

    costs: {
      by: (groupBy: CostGroupBy, params: PageParams = {}) =>
        client.get<Page<CostRow>>('/api/costs', { groupBy, ...defined(params) }),
      budget: () => client.get<BudgetView>('/api/costs/budget'),
      setCap: (capUsd: number) =>
        client.request<BudgetView>('PUT', '/api/costs/budget', { body: { capUsd } }),
    },

    apify: {
      log: (params: { runs?: number; limit?: number } = {}) =>
        client.get<ApifyLog>('/api/apify/log', defined(params)),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
