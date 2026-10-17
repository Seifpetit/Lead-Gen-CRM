import { APIFY_EVENT_PRICES } from '../config/pricing.js';
import { costEntry, type CostEntry } from '../lib/cost.js';
import { defaultHttp, type HttpJson } from './http.js';
import type { ApifyRunRef, ApifyRunStatus, ApifyUsage, ProviderJob, RunOptions } from './types.js';

const BASE_URL = 'https://api.apify.com/v2';
const PAGE_SIZE = 1000;

interface ApifyRunData {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  usageTotalUsd?: number | null;
  chargedEventCounts?: Record<string, number> | null;
  pricingInfo?: {
    pricingPerEvent?: {
      actorChargeEvents?: Record<string, { eventPriceUsd?: number }>;
    };
  } | null;
}

export interface ApifyRun {
  ref: ApifyRunRef;
  status: ApifyRunStatus;
  usage: ApifyUsage;
  /** Event prices the run itself reports, used for events missing from config/pricing.ts. */
  reportedPrices: Record<string, number>;
}

const RUNNING: ApifyRunStatus[] = ['READY', 'RUNNING'];

/** "compass/crawler-google-places" -> "compass~crawler-google-places" for API paths. */
const actorPath = (actorId: string) => encodeURIComponent(actorId.replace('/', '~'));

/**
 * Minimal Apify API client: start a run, read a run, read a dataset. Nothing else, so an
 * adapter can't wait on, abort or resurrect runs behind the runner's back. The token goes in
 * the Authorization header, never in a URL, so it can't reach logs through an error.
 */
export class ApifyClient {
  constructor(
    private readonly token: string,
    private readonly http: HttpJson = defaultHttp,
    private readonly baseUrl: string = BASE_URL,
  ) {
    if (token.trim() === '') throw new Error('Apify token is missing');
  }

  private get headers() {
    return { authorization: `Bearer ${this.token}` };
  }

  async startRun(actorId: string, input: unknown, options: RunOptions = {}): Promise<ApifyRun> {
    const params = new URLSearchParams();
    if (options.maxTotalChargeUsd !== undefined) {
      params.set('maxTotalChargeUsd', String(options.maxTotalChargeUsd));
    }
    const qs = params.size > 0 ? `?${params}` : '';
    const res = await this.http<{ data: ApifyRunData }>(
      `${this.baseUrl}/acts/${actorPath(actorId)}/runs${qs}`,
      { method: 'POST', headers: this.headers, body: input },
    );
    return toRun(actorId, res.data);
  }

  async getRun(ref: ApifyRunRef): Promise<ApifyRun> {
    const res = await this.http<{ data: ApifyRunData }>(
      `${this.baseUrl}/actor-runs/${encodeURIComponent(ref.runId)}`,
      { headers: this.headers },
    );
    return toRun(ref.actorId, res.data);
  }

  async datasetItems<T>(datasetId: string): Promise<T[]> {
    const items: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.http<T[]>(
        `${this.baseUrl}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${PAGE_SIZE}`,
        { headers: this.headers },
      );
      items.push(...page);
      if (page.length < PAGE_SIZE) return items;
    }
  }
}

function toRun(actorId: string, d: ApifyRunData): ApifyRun {
  const reportedPrices: Record<string, number> = {};
  for (const [event, info] of Object.entries(
    d.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {},
  )) {
    if (typeof info.eventPriceUsd === 'number') reportedPrices[event] = info.eventPriceUsd;
  }
  return {
    ref: { actorId, runId: d.id, datasetId: d.defaultDatasetId },
    status: d.status,
    usage: {
      chargedEventCounts: d.chargedEventCounts ?? {},
      usageTotalUsd: d.usageTotalUsd ?? null,
    },
    reportedPrices,
  };
}

/** USD price of one Actor event: config first, then what the run reports, else 0. */
export function eventPrice(
  actorId: string,
  event: string,
  reported: Record<string, number> = {},
): number | null {
  return APIFY_EVENT_PRICES[actorId]?.[event] ?? reported[event] ?? null;
}

/** Cost entries for the events a run was charged for. */
export function costsFromUsage(run: ApifyRun): CostEntry[] {
  return Object.entries(run.usage.chargedEventCounts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([event, count]) => {
      const price = eventPrice(run.ref.actorId, event, run.reportedPrices);
      if (price === null) throw new Error(`No price for ${run.ref.actorId} event ${event}`);
      return costEntry('apify', `${run.ref.actorId}#${event}`, count, price);
    });
}

/** A pre-run estimate line for an Actor event, priced from config. */
export function estimateEvent(actorId: string, event: string, units: number): CostEntry {
  const price = eventPrice(actorId, event);
  if (price === null) throw new Error(`No configured price for ${actorId} event ${event}`);
  return costEntry('apify', `${actorId}#${event}`, units, price);
}

/**
 * Reads a run and, when it has succeeded, its dataset. Costs come from the events Apify says
 * it charged, so they're reported for failed runs too.
 */
export async function collectApifyRun<Raw, T>(
  client: ApifyClient,
  ref: ApifyRunRef,
  map: (items: Raw[], run: ApifyRun) => T[],
): Promise<ProviderJob<T>> {
  const run = await client.getRun(ref);
  if (RUNNING.includes(run.status)) return { state: 'running', run: run.ref, costs: [] };
  const costs = costsFromUsage(run);
  if (run.status !== 'SUCCEEDED') {
    return { state: 'failed', run: run.ref, status: run.status, costs, usage: run.usage };
  }
  const raw = await client.datasetItems<Raw>(run.ref.datasetId);
  return { state: 'succeeded', run: run.ref, items: map(raw, run), costs, usage: run.usage };
}

/** Console link to a run: the source URL for values an Actor produced, like found emails. */
export const apifyRunUrl = (ref: ApifyRunRef) =>
  `https://console.apify.com/view/runs/${encodeURIComponent(ref.runId)}`;
