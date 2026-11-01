import {
  COUNTRY_CODES,
  DEV_LIMITS,
  type DevAreaOption,
  type DevClassifyInput,
  type DevClassifyOutput,
  type DevClassifyRow,
  type DevDiscoverInput,
  type DevDiscoverOutput,
  type DevEstimate,
  type DevHistoryEntry,
  type DevOptions,
  type DevPlaceRow,
  type DevSearchResult,
  type DevStep,
  type DevStepInput,
} from '@lead-gen-crm/shared';
import { z } from 'zod';
import { anthropicPrice, APIFY_MIN_MAX_CHARGE_USD } from '../config/pricing.js';
import { COUNTRIES, getCountry } from '../config/countries.js';
import { recordCost, remainingBudget } from '../data/costLedger.js';
import { isCompanyRemoved } from '../data/crmBoards.js';
import type { Db } from '../data/db.js';
import {
  clearDevSteps,
  createDevRun,
  failStaleDevSteps,
  finishDevStep,
  firstRegionOf,
  getDevStep,
  insertDevStep,
  knownPlaceIds,
  listAreas,
  listDevSteps,
} from '../data/devSteps.js';
import type { UserId } from '../data/ids.js';
import { getRegionBounds, getRegionCountry, getRegionOutline } from '../data/regions.js';
import { getMonthlyBudget } from '../data/userBudget.js';
import type { CostEntry } from '../lib/cost.js';
import { placeInOutline, type Bounds, type Outline } from '../lib/geo.js';
import { normalizeQuery } from '../lib/normalize.js';
import { redactSecrets } from '../lib/redact.js';
import { apifyRunUrl } from '../providers/apify.js';
import { companySystem } from '../providers/anthropicClassifier.js';
import type {
  CompanyDiscovery,
  DiscoveredPlace,
  DiscoveryQuery,
  ProviderJob,
} from '../providers/types.js';
import { cleanWordings } from '../stages/queryGrid.js';
import type { CompanyClassifier, CompanyFacts } from '../stages/classifier.js';
import { isReachable } from '../stages/qualify.js';
import { DEFAULT_RUNNER_CONFIG } from './config.js';
import { actualCosts, maxChargeFor, sumUsd } from './costs.js';
import { EST_INPUT_TOKENS, EST_OUTPUT_TOKENS } from './tradeCheck.js';

// The developer console: run ONE pipeline step by hand (a Google Maps search, or the trade-role
// classifier) and keep what went in and what came out. It calls the real provider adapters, so
// what it shows is what a run would do. It never saves a company, contact, lead, coverage row or
// search query. Its spend goes in the cost ledger on a hidden run of kind 'dev_step'.

/** A refusal the route turns into a plain answer. */
export class DevConsoleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DevConsoleError';
  }
}

// ---------------------------------------------------------------------------------------------
// Input (checked here, so the limits hold whoever calls)

const Text = (max: number) =>
  z
    .string()
    .transform((s) =>
      s
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .pipe(z.string().max(max));
const Country = z.enum(COUNTRY_CODES);
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

const Area = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('cell'),
      regionId: z.string().min(1).max(60),
      cellKey: z.string().min(1).max(100),
    })
    .strict(),
  z.object({ kind: z.literal('region'), regionId: z.string().min(1).max(60) }).strict(),
  z.object({ kind: z.literal('rect'), south: Lat, west: Lng, north: Lat, east: Lng }).strict(),
]);

export const DiscoverBody = z
  .object({
    country: Country,
    language: z.enum(['fr', 'en']),
    words: z
      .array(Text(DEV_LIMITS.maxWordChars).pipe(z.string().min(1)))
      .min(1)
      .max(DEV_LIMITS.maxWords),
    area: Area,
    maxPlaces: z.number().int().min(1).max(DEV_LIMITS.maxPlacesPerSearch),
    capUsd: z
      .number()
      .min(
        DEV_LIMITS.discoverCapMinUsd,
        `A Google Maps search cannot be capped below $${DEV_LIMITS.discoverCapMinUsd.toFixed(2)}: Apify refuses a lower maximum cost.`,
      )
      .max(DEV_LIMITS.discoverCapMaxUsd),
  })
  .strict();

export const ClassifyBody = z
  .object({
    country: Country,
    companies: z
      .array(
        z
          .object({
            name: Text(200).pipe(z.string().min(1)),
            category: Text(200).optional(),
            website: Text(300).optional(),
            text: Text(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(DEV_LIMITS.maxCompanies),
    capUsd: z.number().positive().max(DEV_LIMITS.classifyCapMaxUsd),
  })
  .strict();

export const StepParam = z.enum(['discover', 'classify']);

// ---------------------------------------------------------------------------------------------

export interface DevConsoleDeps {
  db: Db;
  discovery: CompanyDiscovery;
  /** The exact Actor input for one search: the real adapter's own function. */
  buildRequest: (query: DiscoveryQuery) => unknown;
  /** Null when no Anthropic key is set. */
  classifier: CompanyClassifier | null;
  classifierModel: string;
  /** Tokens and keys: hidden from everything stored or returned. */
  secrets: readonly (string | null | undefined)[];
  /** Wait between looks at a running Apify run; 0 in tests. */
  pollMs?: number;
  /** Longest to wait for one Apify run. */
  waitMs?: number;
}

interface ResolvedArea {
  bounds: Bounds;
  regionId: string | null;
  cellKey: string;
  outline: Outline | null;
}

type FinishedJob = Extract<ProviderJob<DiscoveredPlace>, { state: 'succeeded' | 'failed' }>;
const isDone = (job: ProviderJob<DiscoveredPlace>): job is FinishedJob =>
  job.state === 'succeeded' || job.state === 'failed';

const usd = (n: number) => `$${n.toFixed(4)}`;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class DevConsole {
  private readonly live = new Map<string, { id: string; finished: Promise<void> }>();
  private readonly pollMs: number;
  private readonly waitMs: number;

  constructor(private readonly deps: DevConsoleDeps) {
    this.pollMs = deps.pollMs ?? 3_000;
    this.waitMs = deps.waitMs ?? 5 * 60_000;
  }

  /** Resolves when the user's running call has ended; for tests. */
  async whenFinished(userId: UserId): Promise<void> {
    await this.live.get(userId)?.finished;
  }

  private mask<T>(value: T): T {
    return JSON.parse(redactSecrets(JSON.stringify(value), this.deps.secrets)) as T;
  }

  // -------------------------------------------------------------------------------------------
  // What the forms offer

  async options(): Promise<DevOptions> {
    const areas = (await listAreas(this.deps.db)) as DevAreaOption[];
    return {
      countries: COUNTRY_CODES.map((code) => ({
        code,
        name: COUNTRIES[code].name,
        // The search adapter speaks French and English; a country's other languages are not offered.
        languages: COUNTRIES[code].languages.filter(
          (l): l is 'fr' | 'en' => l === 'fr' || l === 'en',
        ),
      })),
      areas,
      classifierConfigured: this.deps.classifier !== null,
      classifierModel: this.deps.classifierModel,
      limits: DEV_LIMITS,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Estimate (never spends)

  async estimate(userId: UserId, step: DevStep, input: DevStepInput): Promise<DevEstimate> {
    if (step === 'discover') return this.estimateDiscover(userId, input as DevDiscoverInput);
    return this.estimateClassify(userId, input as DevClassifyInput);
  }

  private async monthRoom(userId: UserId): Promise<number> {
    const b = await getMonthlyBudget(this.deps.db, userId, new Date());
    return b.capUsd === null ? Infinity : Math.max(0, b.capUsd - b.spentUsd);
  }

  private async resolveArea(input: DevDiscoverInput): Promise<ResolvedArea> {
    const { db } = this.deps;
    const area = input.area;
    if (area.kind === 'rect') {
      if (!(area.south < area.north) || !(area.west < area.east)) {
        throw new DevConsoleError(
          400,
          'bad_rectangle',
          'The rectangle must have south below north and west below east.',
        );
      }
      return {
        bounds: { south: area.south, west: area.west, north: area.north, east: area.east },
        regionId: null,
        cellKey: 'custom',
        outline: null,
      };
    }
    const country = await getRegionCountry(db, area.regionId);
    if (!country) throw new DevConsoleError(400, 'unknown_area', 'That region does not exist.');
    if (country !== input.country) {
      throw new DevConsoleError(400, 'wrong_country', 'That region is not in the chosen country.');
    }
    const outline = await getRegionOutline(db, area.regionId);
    if (area.kind === 'region') {
      const bounds = await getRegionBounds(db, area.regionId);
      if (!bounds)
        throw new DevConsoleError(400, 'no_bounds', 'That region has no map bounds yet.');
      return { bounds, regionId: area.regionId, cellKey: 'region', outline };
    }
    const areas = await listAreas(db);
    const cell = areas
      .find((r) => r.regionId === area.regionId)
      ?.cells.find((c) => c.cellKey === area.cellKey);
    if (!cell) {
      throw new DevConsoleError(
        400,
        'unknown_area',
        'That cell does not exist yet. Cells are made the first time a region is searched; pick Whole region or a Custom rectangle.',
      );
    }
    const { south, west, north, east } = cell;
    return {
      bounds: { south, west, north, east },
      regionId: area.regionId,
      cellKey: cell.cellKey,
      outline,
    };
  }

  private queriesFor(input: DevDiscoverInput, area: ResolvedArea): DiscoveryQuery[] {
    return cleanWordings(input.words)
      .slice(0, DEV_LIMITS.maxWords)
      .map((word) => ({
        regionId: area.regionId ?? '',
        cellKey: area.cellKey,
        bounds: area.bounds,
        sectorId: null,
        textQuery: word,
        normalizedQuery: normalizeQuery(word),
        languageCode: input.language,
        maxPlaces: input.maxPlaces,
      }));
  }

  private async estimateDiscover(userId: UserId, input: DevDiscoverInput): Promise<DevEstimate> {
    const area = await this.resolveArea(input);
    const queries = this.queriesFor(input, area);
    const lines = queries.map((q) => ({
      label: q.textQuery,
      usd: sumUsd(this.deps.discovery.estimate(q)),
    }));
    const estimateUsd = round6(lines.reduce((s, l) => s + l.usd, 0));
    const room = await this.monthRoom(userId);
    const cap = Math.min(input.capUsd, room);
    // A search starts only while the cap still leaves Google Maps' minimum free.
    const minimum = APIFY_MIN_MAX_CHARGE_USD[this.deps.discovery.name] ?? 0;
    let planned = 0;
    let fit = 0;
    for (const line of lines) {
      if (cap - planned < minimum) break;
      planned += line.usd;
      fit += 1;
    }
    const fitNotice =
      fit < lines.length
        ? `Google Maps needs ${usd(minimum)} free to start each search, so with this cap only the first ${fit} of ${lines.length} words can run. Raise the cap to run them all.`
        : null;
    return {
      step: 'discover',
      estimateUsd,
      capUsd: cap,
      lines,
      requests: this.mask(queries.map((q) => this.deps.buildRequest(q))),
      searches: queries.length,
      notice: fitNotice ?? this.capNotice(estimateUsd, input.capUsd, room),
    };
  }

  private capNotice(estimateUsd: number, capUsd: number, room: number): string | null {
    if (room <= 0) return 'The monthly spending cap is reached: nothing can be run.';
    if (room < capUsd) return `The month only has ${usd(room)} left, so that is this call's cap.`;
    if (estimateUsd > capUsd) {
      return `The estimate is above the cap of ${usd(capUsd)}: the last searches may be left out.`;
    }
    return null;
  }

  private perCallUsd(): number {
    const p = anthropicPrice(this.deps.classifierModel);
    return (EST_INPUT_TOKENS * p.input + EST_OUTPUT_TOKENS * p.output) / 1e6;
  }

  private async estimateClassify(userId: UserId, input: DevClassifyInput): Promise<DevEstimate> {
    if (!this.deps.classifier) {
      throw new DevConsoleError(
        409,
        'classifier_not_configured',
        'No Anthropic key is set, so there is no classifier to run.',
      );
    }
    const per = this.perCallUsd();
    const lines = input.companies.map((c) => ({ label: c.name, usd: round6(per) }));
    const estimateUsd = round6(per * input.companies.length);
    const room = await this.monthRoom(userId);
    const country = getCountry(input.country);
    return {
      step: 'classify',
      estimateUsd,
      capUsd: Math.min(input.capUsd, room),
      lines,
      requests: [companySystem(country.mode, this.partnerName(input.country))],
      searches: input.companies.length,
      notice: this.capNotice(estimateUsd, input.capUsd, room),
    };
  }

  private partnerName(country: string): string {
    const partner = getCountry(country).partnerCountry;
    return partner ? getCountry(partner).name : 'Tunisia';
  }

  // -------------------------------------------------------------------------------------------
  // Run (spends; one at a time per user)

  async start(userId: UserId, step: DevStep, input: DevStepInput): Promise<DevHistoryEntry> {
    if (this.live.has(userId)) {
      throw new DevConsoleError(
        409,
        'already_running',
        'A console call is still running. Wait for it to finish.',
      );
    }
    // Held from here on, so two quick clicks cannot both get through the checks below.
    this.live.set(userId, { id: '', finished: Promise.resolve() });
    try {
      return await this.begin(userId, step, input);
    } catch (err) {
      this.live.delete(userId);
      throw err;
    }
  }

  private async begin(
    userId: UserId,
    step: DevStep,
    input: DevStepInput,
  ): Promise<DevHistoryEntry> {
    const { db } = this.deps;
    const budget = await getMonthlyBudget(db, userId, new Date());
    if (budget.capUsd !== null && budget.spentUsd >= budget.capUsd) {
      throw new DevConsoleError(409, 'monthly_cap_reached', 'The monthly spending cap is reached.');
    }
    // Everything that can be refused is refused before the first dollar and before a history row.
    let plan: () => Promise<void>;
    const id = { value: '' };
    if (step === 'discover') {
      const typed = input as DevDiscoverInput;
      const area = await this.resolveArea(typed);
      const queries = this.queriesFor(typed, area);
      const regionId = area.regionId ?? (await firstRegionOf(db, typed.country));
      if (!regionId)
        throw new DevConsoleError(
          400,
          'no_region',
          'That country has no region to record the cost on.',
        );
      id.value = await insertDevStep(db, userId, step, this.mask(typed));
      plan = () => this.runDiscover(userId, id.value, typed, area, queries, regionId);
    } else {
      const typed = input as DevClassifyInput;
      if (!this.deps.classifier) {
        throw new DevConsoleError(
          409,
          'classifier_not_configured',
          'No Anthropic key is set, so there is no classifier to run.',
        );
      }
      const regionId = await firstRegionOf(db, typed.country);
      if (!regionId)
        throw new DevConsoleError(
          400,
          'no_region',
          'That country has no region to record the cost on.',
        );
      id.value = await insertDevStep(db, userId, step, this.mask(typed));
      plan = () => this.runClassify(userId, id.value, typed, regionId);
    }
    const finished = plan()
      .catch(async (err: unknown) => {
        await finishDevStep(db, userId, id.value, {
          status: 'failed',
          output: null,
          costUsd: 0,
          error: this.errorText(err),
        }).catch(() => undefined);
      })
      .finally(() => {
        this.live.delete(userId);
      });
    this.live.set(userId, { id: id.value, finished });
    return (await getDevStep(db, userId, id.value))!;
  }

  private errorText(err: unknown): string {
    const text = err instanceof Error ? err.message : 'The step failed.';
    return redactSecrets(text, this.deps.secrets).slice(0, 500);
  }

  // The ledger rows for one finished (or part-finished) job; returns what was recorded.
  private async record(
    userId: UserId,
    runId: string,
    costs: readonly CostEntry[],
  ): Promise<number> {
    for (const c of costs) {
      await recordCost(this.deps.db, userId, {
        runId,
        provider: c.provider,
        item: c.item,
        units: c.units,
        unitPriceUsd: c.unitPriceUsd,
        kind: 'actual',
      });
    }
    return sumUsd(costs);
  }

  private async runDiscover(
    userId: UserId,
    historyId: string,
    input: DevDiscoverInput,
    area: ResolvedArea,
    queries: DiscoveryQuery[],
    ledgerRegion: string,
  ): Promise<void> {
    const { db, discovery } = this.deps;
    const began = Date.now();
    const runId = await createDevRun(db, userId, ledgerRegion, input.capUsd);
    const actorMin = APIFY_MIN_MAX_CHARGE_USD[discovery.name] ?? 0;
    const requests = this.mask(queries.map((q) => this.deps.buildRequest(q)));
    const searches: DevSearchResult[] = [];
    const found: { place: DiscoveredPlace; word: string }[] = [];
    const skipped: string[] = [];
    let spent = 0;
    let notice: string | null = null;
    let error: string | null = null;

    for (const [i, q] of queries.entries()) {
      const remaining = await remainingBudget(db, userId, runId);
      const est = sumUsd(discovery.estimate(q));
      const maxCharge = maxChargeFor(
        est,
        remaining,
        DEFAULT_RUNNER_CONFIG.maxChargeHeadroom,
        actorMin,
      );
      if (maxCharge === null) {
        skipped.push(...queries.slice(i).map((x) => x.textQuery));
        notice = `Stopped before "${q.textQuery}": the spend cap leaves ${usd(remaining)}, and Google Maps needs at least ${usd(actorMin)} to start a search.`;
        break;
      }
      try {
        const job = await this.finish(
          await discovery.discoverCompanies(q, { maxTotalChargeUsd: maxCharge }),
        );
        if (!isDone(job)) {
          // Apify is still working on it; what it will charge is unknown, so nothing is recorded.
          searches.push({
            word: q.textQuery,
            returned: 0,
            costUsd: 0,
            apifyRunId: job.run.runId,
            apifyRunUrl: apifyRunUrl(job.run),
            status: 'STILL RUNNING',
          });
          skipped.push(...queries.slice(i + 1).map((x) => x.textQuery));
          error = `Apify did not finish "${q.textQuery}" in ${Math.round(this.waitMs / 1000)} seconds. It may still be running (see the Apify console); its cost is not recorded here.`;
          break;
        }
        const cost = await this.record(userId, runId, actualCosts(job.costs, job.usage));
        spent += cost;
        const items = job.items ?? [];
        for (const place of items) found.push({ place, word: q.textQuery });
        searches.push({
          word: q.textQuery,
          returned: items.length,
          costUsd: cost,
          apifyRunId: job.run?.runId ?? null,
          apifyRunUrl: job.run ? apifyRunUrl(job.run) : null,
          status: job.state === 'succeeded' ? 'SUCCEEDED' : job.status,
        });
      } catch (err) {
        skipped.push(...queries.slice(i + 1).map((x) => x.textQuery));
        error = `The search for "${q.textQuery}" failed: ${this.errorText(err)}`;
        break;
      }
    }

    const rows = await this.placeRows(userId, found, area);
    const output: DevDiscoverOutput = {
      requests,
      searches,
      places: rows.places,
      counts: rows.counts,
      durationMs: Date.now() - began,
      skippedWords: skipped,
      notice:
        notice ??
        (rows.counts.returned === 0 && error === null
          ? 'Google Maps returned 0 places for this request. The exact request is above: check the words and the area.'
          : null),
    };
    await finishDevStep(db, userId, historyId, {
      status: error === null ? 'succeeded' : 'failed',
      output: this.mask(output),
      costUsd: round6(spent),
      error,
    });
  }

  /** Waits for a started Apify run (polling the real adapter); a run that never ends stays 'running'. */
  private async finish(first: ProviderJob<DiscoveredPlace>): Promise<ProviderJob<DiscoveredPlace>> {
    let job = first;
    const until = Date.now() + this.waitMs;
    while (job.state === 'started' || job.state === 'running') {
      if (Date.now() > until) return job;
      if (this.pollMs > 0) await new Promise((r) => setTimeout(r, this.pollMs));
      job = await this.deps.discovery.collect(job.run);
    }
    return job;
  }

  private async placeRows(
    userId: UserId,
    found: { place: DiscoveredPlace; word: string }[],
    area: ResolvedArea,
  ): Promise<{ places: DevPlaceRow[]; counts: DevDiscoverOutput['counts'] }> {
    const { db } = this.deps;
    const ids = [...new Set(found.map((f) => f.place.placeId.value))];
    const known = await knownPlaceIds(db, userId, ids);
    const places: DevPlaceRow[] = [];
    const counted = new Set<string>();
    const counts = {
      returned: found.length,
      new: 0,
      outsideRegion: 0,
      alreadyKnown: 0,
      noContact: 0,
    };
    for (const { place, word } of found) {
      const loc = place.location;
      // The same test as a run's: a place with no coordinates cannot be judged and is kept.
      const outside =
        area.outline === null
          ? null
          : loc
            ? !placeInOutline(loc.lat, loc.lng, area.outline)
            : false;
      const phone = place.phones[0]?.value ?? null;
      const removed = await isCompanyRemoved(db, userId, {
        placeId: place.placeId.value,
        name: place.name.value,
        phone,
        governorate: area.regionId ?? '',
      });
      const alreadyKnown = known.has(place.placeId.value) || removed;
      const noContact = !isReachable(place);
      places.push({
        name: place.name.value,
        category: place.category?.value ?? null,
        address: place.address?.value ?? null,
        phone,
        website: place.website?.value ?? null,
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        word,
        outsideRegion: outside,
        alreadyKnown,
        noContact,
      });
      // Counted once per place, the way a run meets a place once.
      if (counted.has(place.placeId.value)) continue;
      counted.add(place.placeId.value);
      if (outside) counts.outsideRegion += 1;
      else if (alreadyKnown) counts.alreadyKnown += 1;
      else {
        counts.new += 1;
        if (noContact) counts.noContact += 1;
      }
    }
    return { places, counts };
  }

  private async runClassify(
    userId: UserId,
    historyId: string,
    input: DevClassifyInput,
    ledgerRegion: string,
  ): Promise<void> {
    const { db } = this.deps;
    const classifier = this.deps.classifier!;
    const began = Date.now();
    const runId = await createDevRun(db, userId, ledgerRegion, input.capUsd);
    const country = getCountry(input.country);
    const partner = this.partnerName(input.country);
    const rows: DevClassifyRow[] = [];
    let spent = 0;
    let skipped = 0;
    let notice: string | null = null;

    for (const [i, c] of input.companies.entries()) {
      const remaining = await remainingBudget(db, userId, runId);
      if (remaining <= 0) {
        skipped = input.companies.length - i;
        notice = `Stopped after ${i} of ${input.companies.length}: the spend cap was reached.`;
        break;
      }
      const facts: CompanyFacts = {
        name: c.name,
        category: c.category || null,
        types: c.text ? [c.text] : [],
        website: c.website || null,
        address: null,
        sourceUrl: c.website || 'https://www.google.com/maps',
        mode: country.mode,
        ...(country.partnerCountry ? { partnerCountry: partner } : {}),
      };
      const result = await classifier.classifyCompany(facts);
      const cost = await this.record(userId, runId, result.costs);
      spent += cost;
      const reason = result.reasons[0] ?? '';
      rows.push({
        name: c.name,
        tradeRole: result.tradeRole ?? null,
        evidence: reason,
        model: result.model ?? null,
        costUsd: cost,
        failed: reason.startsWith('classifier unavailable'),
      });
    }

    const output: DevClassifyOutput = {
      rows,
      system: companySystem(country.mode, partner),
      skipped,
      durationMs: Date.now() - began,
      notice,
    };
    await finishDevStep(db, userId, historyId, {
      status: 'succeeded',
      output: this.mask(output),
      costUsd: round6(spent),
      error: null,
    });
  }

  // -------------------------------------------------------------------------------------------
  // History

  async history(userId: UserId, step: DevStep | null): Promise<DevHistoryEntry[]> {
    await failStaleDevSteps(
      this.deps.db,
      userId,
      this.live.has(userId) ? [this.live.get(userId)!.id] : [],
    );
    return listDevSteps(this.deps.db, userId, step);
  }

  async entry(userId: UserId, id: string): Promise<DevHistoryEntry | null> {
    await failStaleDevSteps(
      this.deps.db,
      userId,
      this.live.has(userId) ? [this.live.get(userId)!.id] : [],
    );
    return getDevStep(this.deps.db, userId, id);
  }

  clear(userId: UserId, step: DevStep | null): Promise<number> {
    return clearDevSteps(this.deps.db, userId, step);
  }
}
