import type {
  LogLevel,
  NoDecisionMakerReason,
  Run,
  RunPreview,
  RunPreviewInput,
  RunStage,
  StartRunInput,
  StepSummary,
} from '@lead-gen-crm/shared';
import { APIFY_MIN_MAX_CHARGE_USD } from '../config/pricing.js';
import { recordApifyEvent, type ApifyState } from '../data/apifyEvents.js';
import { claimCells, listLiveClaims, releaseClaims, renewClaims } from '../data/cellClaims.js';
import { getCompany, setCompanySector, upsertCompany } from '../data/companies.js';
import { setContactPhoto, setMapsImage } from '../data/companyImages.js';
import {
  listCompaniesWithStaleContacts,
  setContactEmail,
  upsertContact,
} from '../data/contacts.js';
import {
  recordCost,
  remainingBudget,
  runSpendByProvider,
  settleStepCosts,
} from '../data/costLedger.js';
import { isCompanyRemoved, isPersonRemoved } from '../data/crmBoards.js';
import { upsertLead } from '../data/crmLeads.js';
import { withTransaction, type Db, type Queryable } from '../data/db.js';
import { insertEvidence } from '../data/evidence.js';
import { listEvidence } from '../data/evidence.js';
import { appendRunLog, appendStepLog, setLiveMessage } from '../data/runLog.js';
import { dismissalFeedback, runFunnel } from '../data/views.js';
import type { UserId } from '../data/ids.js';
import { createRegionGrid, listCells } from '../data/regionCells.js';
import { addCellCoverage } from '../data/regionCoverage.js';
import { getRegionBounds, getRegionOutline } from '../data/regions.js';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import { cellOverlap, placeInOutline } from '../lib/geo.js';
import { liveMessages, type SearchFacts } from '../lib/liveMessages.js';
import { redactSecrets } from '../lib/redact.js';
import {
  addRunCompany,
  listRunCompanies,
  moveRunCompany,
  type RunCompany,
  type RunCompanyState,
} from '../data/runCompanies.js';
import {
  addDroppedPlaces,
  countRuns,
  createRunWithinLimit,
  getRun,
  listUnfinishedRunIds,
  listUsersWithUnfinishedWork,
  touchRun,
  updateRun,
} from '../data/runs.js';
import {
  completeStep,
  ensureStep,
  getStep,
  listSteps,
  lockStep,
  markStepStarted,
  recordApifyStart,
  recordStepPoll,
  reservedHeadroom,
  reserveStepCharge,
  setStepSummary,
  type RunStep,
} from '../data/runSteps.js';
import {
  listCellStats,
  listExhaustedQueries,
  markCellExhausted,
  markQueryExhausted,
  setRegionMode,
} from '../data/saturation.js';
import { recordSearchQuery } from '../data/searchQueries.js';
import { findSuppressed, SuppressedContactError } from '../data/suppressionList.js';
import { getMonthlyBudget } from '../data/userBudget.js';
import type { CostEntry } from '../lib/cost.js';
import { normalizeDomain, normalizeQuery } from '../lib/normalize.js';
import type { Sourced } from '../lib/sourced.js';
import { emailLookupKey } from '../providers/emailFinder.js';
import type {
  ApifyRunRef,
  CompanyDiscovery,
  DiscoveredPlace,
  DiscoveryQuery,
  EmailFinder,
  EmailQuery,
  FoundEmail,
  FoundPerson,
  PeopleFinder,
  PeopleQuery,
  ProviderJob,
  StageProvider,
} from '../providers/types.js';
import {
  buildLeadCandidates,
  type CompanyForLead,
  type PersonForLead,
} from '../stages/buildLeadCandidate.js';
import type { CompanyClassifier, TitleClassifier } from '../stages/classifier.js';
import { matchTitle, type TitleMatch } from '../stages/matchTitle.js';
import { isReachable, qualify, type Qualification } from '../stages/qualify.js';
import { buildQueryGrid, gridShape } from '../stages/queryGrid.js';
import { GUARD_WINDOW, outsideRegionVerdict } from './guard.js';
import { gridSectorIds, usableCells } from './plan.js';
import { applyDismissalFeedback, score } from '../stages/score.js';
import { verifyCurrentRole, type RoleVerification } from '../stages/verifyCurrentRole.js';
import { DEFAULT_RUNNER_CONFIG, type RunnerConfig } from './config.js';
import { actualCosts, checkStepFit, sumUsd } from './costs.js';
import { reviveDates } from './json.js';
import { titleKeywords } from './keywords.js';
import { previewRun } from './preview.js';
import { planRunCells, ALL_WORDINGS } from './scheduler.js';
import { RunChanges } from './changes.js';
import { webhookFor } from './webhooks.js';

export type RunStartErrorCode = 'monthly_cap_reached' | 'no_bounds' | 'no_free_cells';

export class RunStartError extends Error {
  constructor(
    message: string,
    public readonly code: RunStartErrorCode = 'no_bounds',
  ) {
    super(message);
    this.name = 'RunStartError';
  }
}

/** Thrown by a checkpoint hook in tests to simulate the process dying. */
export class SimulatedCrash extends Error {
  constructor(label: string) {
    super(`simulated crash at ${label}`);
    this.name = 'SimulatedCrash';
  }
}

export interface OrchestratorDeps {
  db: Db;
  discovery: CompanyDiscovery;
  people: PeopleFinder;
  emails: EmailFinder;
  companyClassifier?: CompanyClassifier;
  titleClassifier?: TitleClassifier;
  config?: Partial<RunnerConfig>;
  /**
   * Called at every boundary where the process could die: after each commit, and between a
   * paid call and recording its result. Tests throw here to prove recovery.
   */
  checkpoint?: (label: string) => void | Promise<void>;
  /** Structured diagnostics (e.g. why each person was kept or rejected). Defaults to silent. */
  log?: (data: Record<string, unknown>, message: string) => void;
  /** Values that must never appear in a run's log, such as API tokens (patterns are hidden too). */
  secrets?: readonly (string | null | undefined)[];
}

export interface AdvanceResult {
  status: Run['status'];
  stage: RunStage | null;
  /** Paid steps still out with a provider. */
  inFlight: number;
  /** True when this pass changed anything. */
  progressed: boolean;
}

const STAGES: RunStage[] = ['discover', 'qualify', 'find_people', 'enrich', 'verify', 'score'];
const TERMINAL_COMPANY: RunCompanyState[] = [
  'scored',
  'rejected',
  'review',
  'skipped',
  'unreachable',
];

interface DiscoverPayload {
  place: DiscoveredPlace;
  querySectorId: string | null;
  qualification?: Qualification;
  people?: StoredPerson[];
  peopleDiagnostics?: PeopleDiagnostics;
  emails?: Record<string, FoundEmail>;
  refresh?: boolean;
}

/** What the people step searched for, what came back and why each person was kept or not. */
interface PeopleDiagnostics {
  input: PeopleQuery;
  returned: number;
  kept: number;
  rejected: {
    name: string;
    headline: string | null;
    code: NoDecisionMakerReason;
    reason: string;
  }[];
}

interface StoredPerson {
  person: FoundPerson;
  title: TitleMatch;
  role: RoleVerification;
  contactId: string | null;
  suppressed?: boolean;
  emailKey?: string | null;
}

interface EmailStepInput {
  queries: EmailQuery[];
  refs: { key: string; companyId: string; contactId: string }[];
}

interface PeopleStepInput {
  companyId: string;
  query: PeopleQuery;
}

function splitName(full: string): { first: string; last: string } | null {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

/**
 * The run orchestrator: the only code that moves a run, a step or a lead between states.
 *
 * Every pass (`advance`) reads state from the database, does what it can without waiting,
 * and commits after every step, so the process can die anywhere and a later pass (or
 * `recover` at startup) picks up from the database alone. Paid steps write their estimated
 * cost before the call and store the Apify run ID before any waiting; a step is never
 * started twice.
 */
export class Orchestrator {
  readonly config: RunnerConfig;
  private readonly db: Db;

  constructor(private readonly deps: OrchestratorDeps) {
    this.db = deps.db;
    this.config = { ...DEFAULT_RUNNER_CONFIG, ...deps.config };
  }

  private async checkpoint(label: string): Promise<void> {
    await this.deps.checkpoint?.(label);
  }

  /** Tells the live stream that something about a user's runs changed. */
  readonly changes = new RunChanges();

  /**
   * The sentence a run shows right now: kept on the run and appended to its log. Plain words
   * only; the technical detail goes through `note`.
   */
  private async say(
    db: Queryable,
    userId: UserId,
    runId: string,
    message: string,
    level: LogLevel = 'info',
  ): Promise<void> {
    const text = redactSecrets(message, this.deps.secrets);
    await setLiveMessage(db, userId, runId, text);
    await appendRunLog(db, userId, { runId, level, message: text, secrets: this.deps.secrets });
    this.changes.notify(userId);
  }

  /** A technical line about one step, for the full log only. */
  private async note(
    db: Queryable,
    userId: UserId,
    stepId: string,
    message: string,
    level: LogLevel = 'info',
  ): Promise<void> {
    await appendStepLog(db, userId, {
      runStepId: stepId,
      level,
      message,
      secrets: this.deps.secrets,
    });
    this.changes.notify(userId);
  }

  /** The region's name and the sector names a run searches, for its sentences. */
  private async searchFacts(run: Run): Promise<SearchFacts> {
    const { rows } = await this.db.query<{ name: string }>(
      'SELECT name FROM regions WHERE id = $1',
      [run.region],
    );
    const names = new Map(FREIGHT_SECTORS.map((s) => [s.id as string, s.name]));
    return {
      region: rows[0]?.name ?? run.region,
      sectors: run.sectors.map((id) => names.get(id) ?? id),
      customOnly: run.customOnly,
    };
  }

  /** "3 of 12 searches done" while a stage's steps land, so the sentence keeps moving. */
  private async sayProgress(userId: UserId, runId: string, stage: RunStage): Promise<void> {
    if (stage !== 'discover' && stage !== 'find_people') return;
    const run = await getRun(this.db, userId, runId);
    if (
      !run ||
      run.currentStage !== stage ||
      (run.status !== 'running' && run.status !== 'pending')
    ) {
      return;
    }
    const steps = (await listSteps(this.db, userId, runId)).filter((s) => s.stage === stage);
    const done = steps.filter((s) => s.status === 'finished' || s.status === 'failed').length;
    if (steps.length === 0 || done === steps.length) return;
    if (stage === 'discover') {
      const funnel = await runFunnel(this.db, userId, runId);
      await this.say(
        this.db,
        userId,
        runId,
        liveMessages.searchingProgress({
          ...(await this.searchFacts(run)),
          done,
          total: steps.length,
          found: funnel.discovered,
        }),
      );
    } else {
      await this.say(
        this.db,
        userId,
        runId,
        liveMessages.peopleProgress({ done, total: steps.length }),
      );
    }
  }

  private providerFor(stage: RunStage): StageProvider<unknown> & {
    estimate(input: never): CostEntry[];
  } {
    if (stage === 'discover') return this.deps.discovery as never;
    if (stage === 'find_people') return this.deps.people as never;
    if (stage === 'enrich') return this.deps.emails as never;
    throw new Error(`Stage ${stage} has no provider`);
  }

  // -------------------------------------------------------------------------------------
  // Preview and stop

  /** Estimated volume and cost of a run, and what would block starting it. Spends nothing. */
  preview(userId: UserId, input: RunPreviewInput): Promise<RunPreview> {
    return previewRun(
      {
        db: this.db,
        discovery: this.deps.discovery,
        people: this.deps.people,
        emails: this.deps.emails,
        config: this.config,
      },
      userId,
      input,
    );
  }

  /**
   * Stops a run that is pending or running. Steps not yet started never start. Apify runs
   * already out can't be aborted from here (the adapters only start and read runs); they are
   * collected and settled on later passes, and their max cost bounds what they can spend.
   * Returns null when the run isn't the user's; `stopped` is false when it was already over.
   */
  async stopRun(userId: UserId, runId: string): Promise<{ run: Run; stopped: boolean } | null> {
    const run = await getRun(this.db, userId, runId);
    if (!run) return null;
    const updated = await updateRun(this.db, userId, runId, {
      status: 'cancelled',
      error: 'Stopped by the user',
      onlyFrom: ['pending', 'running'],
    });
    if (!updated) return { run, stopped: false };
    await this.say(
      this.db,
      userId,
      runId,
      liveMessages.stopped({ leads: (await runFunnel(this.db, userId, runId)).leads }),
    );
    await this.checkpoint('run:cancelled');
    // Releases the claims when nothing is out with Apify, otherwise when the last step lands.
    await this.advance(userId, runId);
    return { run: (await getRun(this.db, userId, runId))!, stopped: true };
  }

  // -------------------------------------------------------------------------------------
  // Starting a run

  /**
   * Starts a run: checks the monthly cap and the concurrent-run limit, builds the region's
   * cells if needed, claims the cells to search and plans one discovery step per query.
   */
  async startRun(userId: UserId, input: Omit<StartRunInput, 'confirm'>): Promise<Run> {
    const now = new Date();
    const month = await getMonthlyBudget(this.db, userId, now);
    if (month.capUsd !== null && month.spentUsd >= month.capUsd) {
      throw new RunStartError(
        `Monthly cap reached: $${month.spentUsd.toFixed(2)} of $${month.capUsd.toFixed(2)} spent`,
        'monthly_cap_reached',
      );
    }
    const cells = await listCells(this.db, input.regionId, { leafOnly: true });
    if (cells.length === 0) {
      const bounds = await getRegionBounds(this.db, input.regionId);
      if (!bounds)
        throw new RunStartError(`Region ${input.regionId} has no map bounds yet`, 'no_bounds');
      const { rows, cols } = gridShape(bounds, this.config.cellsPerRun * 4);
      // Safe to race: cells are unique per (region, cell key).
      await createRegionGrid(
        this.db,
        input.regionId,
        bounds,
        rows,
        cols,
        await getRegionOutline(this.db, input.regionId),
      );
    }
    const mode = input.mode ?? 'normal';
    const run = await createRunWithinLimit(
      this.db,
      userId,
      {
        regionId: input.regionId,
        budgetCapUsd: input.budgetCapUsd,
        mode,
        // sectorIds omitted = every sector; [] = only the typed-in wordings.
        sectors: input.sectorIds ?? [],
        customOnly: input.sectorIds !== undefined && input.sectorIds.length === 0,
        customWordings: input.customWordings ?? [],
        cellKeys: input.cellKeys ?? [],
      },
      this.config.maxConcurrentRunsPerUser,
    );
    await this.checkpoint('run:created');

    await this.planRun(userId, run);
    return (await getRun(this.db, userId, run.id))!;
  }

  /**
   * Claims the run's cells and plans one discovery step per query. Idempotent, so a run that
   * died right after it was created is planned by the next `advance`: a run that already holds
   * claims keeps them, and steps already planned are left as they are.
   */
  private async planRun(userId: UserId, run: Run): Promise<void> {
    const now = new Date();
    const cells = await listCells(this.db, run.region, { leafOnly: true });
    const outline = await getRegionOutline(this.db, run.region);
    let claimedIds = (await listLiveClaims(this.db, userId))
      .filter((c) => c.runId === run.id)
      .map((c) => c.regionCellId);
    if (claimedIds.length === 0) {
      let stats = await listCellStats(this.db, userId, run.region);
      if (run.cellKeys.length > 0) {
        const wanted = new Set(run.cellKeys);
        stats = stats.filter((c) => wanted.has(c.cellKey));
      }
      // One run in `exploreEvery` goes to the least-searched cells only.
      const explore = (await countRuns(this.db, userId)) % this.config.exploreEvery === 0;
      // Only cells with real area inside the region, the most inside first.
      const usable = usableCells(stats, outline);
      const plan = planRunCells(usable.cells, this.config, {
        mode: run.mode,
        now,
        explore,
        overlap: usable.overlap,
      });
      claimedIds = await claimCells(this.db, userId, run.id, plan.cellIds, this.config.claimTtlMs);
    }
    if (claimedIds.length === 0) {
      await this.finish(userId, run.id, 'failed', 'No free cells to search in this region');
      return;
    }
    const exhausted =
      run.mode === 'maintenance' ? [] : await listExhaustedQueries(this.db, userId, run.region);
    const cellById = new Map(cells.map((c) => [c.id, c]));
    const keyToId = new Map(cells.map((c) => [c.cellKey, c.id]));
    const grid = buildQueryGrid({
      regionId: run.region,
      bounds: cells[0]!,
      cells: claimedIds.map((id) => {
        const cell = cellById.get(id)!;
        return {
          key: cell.cellKey,
          bounds: cell,
          ...(outline ? { overlap: cellOverlap(cell, outline) } : {}),
        };
      }),
      ...(gridSectorIds(run) ? { sectorIds: gridSectorIds(run)! } : {}),
      customWordings: run.customWordings,
      exhaustedWordings: exhausted.map((e) => ({
        cellKey: cellById.get(e.regionCellId)?.cellKey ?? null,
        normalizedQuery: e.normalizedQuery,
      })),
      maxPlacesPerQuery: this.config.maxPlacesPerQuery,
    });
    await withTransaction(this.db, async (tx) => {
      for (const q of grid.queries) {
        await ensureStep(tx, userId, {
          runId: run.id,
          stage: 'discover',
          stepKey: `${q.cellKey}|${q.normalizedQuery}`,
          actorId: this.isApify(this.deps.discovery) ? this.deps.discovery.name : null,
          provider: this.deps.discovery.name,
          regionCellId: keyToId.get(q.cellKey)!,
          input: q,
        });
      }
      if (run.mode === 'maintenance') await this.addStaleCompanies(tx, userId, run.id, run.region);
      await updateRun(tx, userId, run.id, { currentStage: 'discover', onlyFrom: ['running'] });
    });
    await this.checkpoint('run:planned');
    await this.say(this.db, userId, run.id, liveMessages.searching(await this.searchFacts(run)));
  }

  /** Everything but Google Places (a plain HTTP request) runs as an Apify Actor run. */
  private isApify(p: { name: string }): boolean {
    return !p.name.startsWith('google-places');
  }

  /** Maintenance: companies whose contacts are older than staleContactDays get re-checked. */
  private async addStaleCompanies(
    tx: Queryable,
    userId: UserId,
    runId: string,
    regionId: string,
  ): Promise<void> {
    const olderThan = new Date(Date.now() - this.config.staleContactDays * 86_400_000);
    for (const companyId of await listCompaniesWithStaleContacts(tx, userId, regionId, olderThan)) {
      const place = await this.placeFromStoredCompany(tx, userId, companyId);
      if (!place) continue;
      const qualification: Qualification = {
        verdict: 'qualified',
        sectorId: place.sector,
        method: 'rules',
        kind: 'estimate',
        reasons: ['qualified in an earlier run; contacts are stale'],
        evidence: [],
        costs: [],
      };
      await addRunCompany(tx, userId, {
        runId,
        companyId,
        regionCellId: place.regionCellId,
        isNew: false,
        state: 'qualified',
        payload: { place: place.place, querySectorId: place.sector, qualification, refresh: true },
      });
    }
  }

  /** Rebuilds a DiscoveredPlace from a stored company and its newest evidence per field. */
  private async placeFromStoredCompany(
    db: Queryable,
    userId: UserId,
    companyId: string,
  ): Promise<{
    place: DiscoveredPlace;
    sector: string | null;
    regionCellId: string | null;
  } | null> {
    const company = await getCompany(db, userId, companyId);
    if (!company) return null;
    const latest = new Map<string, Sourced<string>>();
    for (const e of await listEvidence(db, userId, { companyId })) {
      if (!latest.has(e.field)) {
        latest.set(e.field, {
          value: e.value,
          sourceUrl: e.sourceUrl,
          fetchedAt: new Date(e.fetchedAt),
          kind: e.kind,
        });
      }
    }
    const name = latest.get('name');
    const placeId = latest.get('googlePlaceId');
    if (!name) return null;
    const phone = latest.get('phone');
    const email = latest.get('email');
    return {
      sector: company.sector,
      regionCellId: company.regionCellId,
      place: {
        provider:
          company.sourceProvider === 'google_places' ? 'google_places' : 'apify_google_maps',
        placeId: placeId ?? { ...name, value: company.id },
        name,
        address: null,
        category: null,
        types: [],
        website: latest.get('website') ?? null,
        phones: phone ? [phone] : [],
        emails: email ? [email] : [],
        linkedinUrl: latest.get('linkedinUrl') ?? null,
        location: null,
        businessStatus: null,
        reviewsCount: null,
        mapsUrl: name.sourceUrl,
      },
    };
  }

  // -------------------------------------------------------------------------------------
  // Advancing a run

  /** Runs passes until nothing more can happen without waiting on a provider. */
  async runUntilIdle(userId: UserId, runId: string, maxPasses = 200): Promise<AdvanceResult> {
    let last: AdvanceResult | null = null;
    for (let i = 0; i < maxPasses; i++) {
      last = await this.advance(userId, runId);
      if (!last.progressed) return last;
    }
    return last!;
  }

  /**
   * One pass over a run: renew its claims, poll its in-flight steps, then move its current
   * stage forward as far as it can. Idempotent: safe to call from a webhook, the poller and
   * startup recovery at the same time.
   */
  async advance(userId: UserId, runId: string): Promise<AdvanceResult> {
    let run = await getRun(this.db, userId, runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    let progressed = false;
    const active = run.status === 'running' || run.status === 'pending';
    if (active) {
      await touchRun(this.db, userId, runId);
      await renewClaims(this.db, userId, runId, this.config.claimTtlMs);
    }

    // Collect whatever providers have finished, whatever the run's status: it's paid for.
    for (const step of await this.inFlightSteps(userId, runId)) {
      if (await this.pollStep(userId, run, step)) progressed = true;
    }
    run = (await getRun(this.db, userId, runId))!;

    if (run.status === 'running' && !run.currentStage) {
      await this.planRun(userId, run);
      progressed = true;
      run = (await getRun(this.db, userId, runId))!;
    }
    if (run.status === 'running' && run.currentStage) {
      if (await this.advanceStage(userId, run)) progressed = true;
      run = (await getRun(this.db, userId, runId))!;
    }

    const inFlight = (await this.inFlightSteps(userId, runId)).length;
    if (run.status !== 'running' && run.status !== 'pending' && inFlight === 0) {
      await releaseClaims(this.db, userId, runId);
    }
    return { status: run.status, stage: run.currentStage, inFlight, progressed };
  }

  private async inFlightSteps(userId: UserId, runId: string): Promise<RunStep[]> {
    return (await listSteps(this.db, userId, runId)).filter(
      (s) => (s.status === 'started' || s.status === 'running') && s.processedAt === null,
    );
  }

  private async advanceStage(userId: UserId, run: Run): Promise<boolean> {
    switch (run.currentStage) {
      case 'discover':
        return this.advancePaidStage(userId, run, 'discover', 'qualify');
      case 'qualify':
        return this.runQualify(userId, run);
      case 'find_people':
        if (await this.planPeople(userId, run)) return true;
        return this.advancePaidStage(userId, run, 'find_people', 'enrich');
      case 'enrich':
        if (await this.planEmails(userId, run)) return true;
        return this.advancePaidStage(userId, run, 'enrich', 'verify');
      case 'verify':
        return this.runVerify(userId, run);
      case 'score':
        return this.runScore(userId, run);
      default:
        return false;
    }
  }

  private async moveStage(userId: UserId, runId: string, from: RunStage, to: RunStage) {
    const moved = await updateRun(this.db, userId, runId, {
      currentStage: to,
      onlyFrom: ['running'],
    });
    await this.checkpoint(`stage:${from}->${to}`);
    if (!moved) return;
    const f = await runFunnel(this.db, userId, runId);
    const sentence =
      to === 'qualify'
        ? liveMessages.checking({ found: f.discovered })
        : to === 'find_people'
          ? liveMessages.people({ qualified: f.qualified })
          : to === 'enrich'
            ? liveMessages.contacts({ people: f.peopleFound })
            : to === 'verify'
              ? liveMessages.verifying({ companies: f.enriched })
              : to === 'score'
                ? liveMessages.scoring({ companies: f.enriched })
                : null;
    if (sentence) await this.say(this.db, userId, runId, sentence);
  }

  /**
   * Starts pending steps of a paid stage (up to maxInFlightSteps), and moves to the next stage
   * once every step has been applied.
   */
  private async advancePaidStage(
    userId: UserId,
    run: Run,
    stage: RunStage,
    next: RunStage,
  ): Promise<boolean> {
    const steps = (await listSteps(this.db, userId, run.id)).filter((s) => s.stage === stage);
    let inFlight = steps.filter((s) => s.status === 'started' || s.status === 'running').length;
    let progressed = false;
    for (const step of steps.filter((s) => s.status === 'pending')) {
      if (inFlight >= this.config.maxInFlightSteps) break;
      const outcome = await this.startStep(userId, run, step);
      if (outcome === 'capped') return true;
      if (outcome === 'waiting') break;
      progressed = true;
      if (outcome === 'started') inFlight++;
    }
    const all = (await listSteps(this.db, userId, run.id)).filter((s) => s.stage === stage);
    if (all.every((s) => s.processedAt !== null)) {
      if (stage === 'discover') await this.evaluateExhaustion(userId, run);
      await this.moveStage(userId, run.id, stage, next);
      return true;
    }
    return progressed;
  }

  /**
   * Starts one paid step: refuses it if its estimate doesn't fit the remaining budget, writes
   * the estimate to the ledger, then calls the provider. Apify steps store the run and dataset
   * IDs straight after the call; synchronous steps apply their result straight away.
   */
  private async startStep(
    userId: UserId,
    run: Run,
    step: RunStep,
  ): Promise<'started' | 'done' | 'capped' | 'skipped' | 'waiting'> {
    // A pending step with an estimate already written was interrupted between writing it and
    // recording the start: the call may have gone out. Never start it twice.
    if (await this.hasEstimate(userId, step.id)) {
      await withTransaction(this.db, (tx) =>
        completeStep(tx, userId, step.id, {
          status: 'failed',
          error: 'interrupted before the provider run was recorded; estimate kept as spend',
        }),
      );
      await this.applyFailedStep(userId, run, step);
      return 'skipped';
    }
    if (step.regionCellId) {
      const held = await claimCells(
        this.db,
        userId,
        run.id,
        [step.regionCellId],
        this.config.claimTtlMs,
      );
      if (held.length === 0) {
        await withTransaction(this.db, (tx) =>
          completeStep(tx, userId, step.id, {
            status: 'failed',
            error: 'cell is claimed by another run',
          }),
        );
        return 'skipped';
      }
    }
    const provider = this.providerFor(step.stage);
    const input = reviveDates<never>(step.input);
    const estimate = provider.estimate(this.providerInput(step.stage, input) as never);
    const estimateUsd = sumUsd(estimate);
    const now = new Date();
    const remaining = await remainingBudget(
      this.db,
      userId,
      run.id,
      now,
      await reservedHeadroom(this.db, userId, run.id),
    );
    const fit = checkStepFit({
      estimateUsd,
      remainingUsd: remaining,
      unreservedUsd: await remainingBudget(this.db, userId, run.id, now),
      headroom: this.config.maxChargeHeadroom,
      hasActor: step.actorId !== null,
      actorMinimumUsd: step.actorId ? (APIFY_MIN_MAX_CHARGE_USD[step.actorId] ?? 0) : 0,
    });
    if (!fit.fits && fit.wait) return 'waiting';
    if (!fit.fits) {
      await updateRun(this.db, userId, run.id, {
        status: 'stopped_by_cap',
        error: `Next ${step.stage} step can't start (${fit.reason === 'actor_minimum' ? 'Actor minimum' : 'estimate'}): ${fit.message}`,
        onlyFrom: ['running', 'pending'],
      });
      await this.say(
        this.db,
        userId,
        run.id,
        liveMessages.cappedOut({ leads: (await runFunnel(this.db, userId, run.id)).leads }),
        'warn',
      );
      await this.note(this.db, userId, step.id, `Not started: ${fit.message}`, 'warn');
      await this.checkpoint('run:stopped_by_cap');
      return 'capped';
    }
    const maxCharge = fit.maxChargeUsd ?? remaining;

    await withTransaction(this.db, async (tx) => {
      for (const e of estimate) {
        await recordCost(tx, userId, {
          runId: run.id,
          runStepId: step.id,
          regionCellId: step.regionCellId,
          provider: e.provider,
          item: e.item,
          units: e.units,
          unitPriceUsd: e.unitPriceUsd,
          kind: 'estimated',
        });
      }
      if (step.actorId) await reserveStepCharge(tx, userId, step.id, maxCharge);
      else await markStepStarted(tx, userId, step.id);
    });
    await this.checkpoint(`${step.stage}:estimated`);
    await this.note(
      this.db,
      userId,
      step.id,
      `Started: estimated cost $${estimateUsd.toFixed(4)}, at most $${maxCharge.toFixed(2)}`,
    );

    const options = {
      ...(step.actorId ? { maxTotalChargeUsd: maxCharge } : {}),
      ...(step.actorId && this.config.webhook
        ? { webhooks: [webhookFor(this.config.webhook, userId, step.id)] }
        : {}),
    };
    const job = await this.callProvider(step.stage, input, options);
    await this.checkpoint(`${step.stage}:called`);

    if (job.state !== 'succeeded' && job.state !== 'failed') {
      await withTransaction(this.db, async (tx) => {
        await recordApifyStart(tx, userId, step.id, {
          apifyRunId: job.run.runId,
          apifyDatasetId: job.run.datasetId,
        });
        await this.event(tx, userId, step.id, 'started');
      });
      await this.checkpoint(`${step.stage}:started`);
      return 'started';
    }
    await this.applyJob(userId, run, step, job);
    return 'done';
  }

  private async hasEstimate(userId: UserId, stepId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      "SELECT 1 FROM cost_ledger WHERE user_id = $1 AND run_step_id = $2 AND kind = 'estimated' LIMIT 1",
      [userId, stepId],
    );
    return rows.length > 0;
  }

  /** What the provider itself is asked: steps also carry the refs needed to apply results. */
  private providerInput(stage: RunStage, input: unknown): unknown {
    if (stage === 'find_people') return (input as PeopleStepInput).query;
    if (stage === 'enrich') return (input as EmailStepInput).queries;
    return input;
  }

  private callProvider(
    stage: RunStage,
    input: unknown,
    options: object,
  ): Promise<ProviderJob<unknown>> {
    if (stage === 'discover')
      return this.deps.discovery.discoverCompanies(input as DiscoveryQuery, options);
    if (stage === 'find_people')
      return this.deps.people.findPeople((input as PeopleStepInput).query, options);
    if (stage === 'enrich')
      return this.deps.emails.findEmails((input as EmailStepInput).queries, options);
    throw new Error(`Stage ${stage} has no provider`);
  }

  private async event(
    db: Queryable,
    userId: UserId,
    stepId: string,
    state: ApifyState,
    message?: string,
  ): Promise<void> {
    await recordApifyEvent(db, userId, {
      runStepId: stepId,
      state,
      ...(message ? { message } : {}),
    });
    await appendStepLog(db, userId, {
      runStepId: stepId,
      level: state === 'failed' ? 'error' : state === 'restarting' ? 'warn' : 'info',
      message: `Apify run ${state}${message ? `: ${message}` : ''}`,
      secrets: this.deps.secrets,
    });
    this.changes.notify(userId);
  }

  /** Polls one in-flight Apify step and applies its result when it has one. */
  private async pollStep(userId: UserId, run: Run, step: RunStep): Promise<boolean> {
    if (!step.apifyRunId || !step.apifyDatasetId || !step.actorId) {
      // A synchronous step left 'started' by a crash mid-call: its result is lost, and calling
      // again would pay twice. Close it; the estimate stays as spend.
      await withTransaction(this.db, (tx) =>
        completeStep(tx, userId, step.id, {
          status: 'failed',
          error: 'interrupted during a synchronous call; estimate kept as spend',
        }),
      );
      await this.applyFailedStep(userId, run, step);
      return true;
    }
    const ref: ApifyRunRef = {
      actorId: step.actorId,
      runId: step.apifyRunId,
      datasetId: step.apifyDatasetId,
    };
    const job = await this.providerFor(step.stage).collect(ref);
    if (job.state !== 'succeeded' && job.state !== 'failed') {
      const restarts = job.restarts ?? step.apifyRestarts;
      const firstRunning = step.status === 'started';
      await withTransaction(this.db, async (tx) => {
        await recordStepPoll(tx, userId, step.id, {
          apifyStatus: job.status ?? 'RUNNING',
          running: true,
          apifyRestarts: restarts,
        });
        if (firstRunning) await this.event(tx, userId, step.id, 'running');
        if (restarts > step.apifyRestarts) {
          await this.event(
            tx,
            userId,
            step.id,
            'restarting',
            `Apify restarted or migrated the run (${restarts})`,
          );
        }
      });
      return firstRunning || restarts > step.apifyRestarts;
    }
    return this.applyJob(userId, run, step, job);
  }

  /**
   * Applies a provider result in one transaction: settles the step's costs (estimates
   * reversed, actuals appended), stores the output, completes the step and writes the records
   * it produces. A duplicate (second webhook, poll racing a webhook) finds the step processed
   * and changes nothing.
   */
  private async applyJob(
    userId: UserId,
    run: Run,
    step: RunStep,
    job: Exclude<ProviderJob<unknown>, { state: 'started' | 'running' }>,
  ): Promise<boolean> {
    const applied = await withTransaction(this.db, async (tx) => {
      const locked = await lockStep(tx, userId, step.id);
      if (!locked || locked.processedAt) return false;
      const actuals = actualCosts(job.costs, job.usage);
      await settleStepCosts(tx, userId, {
        runId: run.id,
        runStepId: step.id,
        regionCellId: step.regionCellId,
        actuals: actuals.map((c) => ({
          provider: c.provider,
          item: c.item,
          units: c.units,
          unitPriceUsd: c.unitPriceUsd,
        })),
      });
      const items = job.state === 'succeeded' ? job.items : (job.items ?? []);
      const output = {
        items,
        usage: job.usage,
        ...(job.state === 'failed' ? { status: job.status } : {}),
      };
      await completeStep(tx, userId, step.id, {
        status: job.state === 'succeeded' ? 'finished' : 'failed',
        output,
        ...(job.state === 'failed' ? { error: `provider status ${job.status}` } : {}),
        ...(step.actorId
          ? { apifyStatus: job.state === 'succeeded' ? 'SUCCEEDED' : job.status }
          : {}),
      });
      if (job.state === 'failed') {
        await this.note(tx, userId, step.id, `Step failed: provider status ${job.status}`, 'error');
      }
      const fresh = reviveDates<{ items: unknown[] }>(output);
      await this.applyItems(
        tx,
        userId,
        run,
        step,
        fresh.items,
        sumUsd(actuals),
        job.state === 'succeeded',
      );
      if (step.actorId && locked.apifyRunId) {
        await this.event(
          tx,
          userId,
          step.id,
          job.state === 'succeeded' ? 'finished' : 'failed',
          job.state === 'failed' ? job.status : undefined,
        );
      }
      return true;
    });
    if (applied) {
      await this.checkpoint(`${step.stage}:applied`);
      await this.sayProgress(userId, run.id, step.stage);
      if (step.stage === 'discover') await this.guardOutsideRegion(userId, run);
    }
    return applied;
  }

  /**
   * Stops a run whose first searches returned almost only places outside the region, before it
   * pays for more of them. Nothing new starts; searches already out are still collected.
   */
  private async guardOutsideRegion(userId: UserId, run: Run): Promise<void> {
    const { rows } = await this.db.query<{ summary: StepSummary }>(
      `SELECT summary FROM run_steps
        WHERE user_id = $1 AND run_id = $2 AND stage = 'discover' AND summary IS NOT NULL
        ORDER BY finished_at, id LIMIT $3`,
      [userId, run.id, GUARD_WINDOW],
    );
    const verdict = outsideRegionVerdict(rows.map((r) => r.summary));
    if (!verdict.stop) return;
    const message = liveMessages.outsideRegion({
      outside: verdict.outside,
      total: verdict.returned,
      region: (await this.searchFacts(run)).region,
    });
    const stopped = await updateRun(this.db, userId, run.id, {
      status: 'cancelled',
      error: message,
      onlyFrom: ['pending', 'running'],
    });
    if (!stopped) return;
    await this.say(this.db, userId, run.id, message, 'warn');
    await this.checkpoint('run:cancelled');
    await this.advance(userId, run.id);
  }

  /** A failed step with nothing to apply still moves its companies on. */
  private async applyFailedStep(userId: UserId, run: Run, step: RunStep): Promise<void> {
    await withTransaction(this.db, (tx) => this.applyItems(tx, userId, run, step, [], 0, false));
  }

  private async applyItems(
    tx: Queryable,
    userId: UserId,
    run: Run,
    step: RunStep,
    items: unknown[],
    costUsd: number,
    complete: boolean,
  ): Promise<void> {
    const input = reviveDates<unknown>(step.input);
    if (step.stage === 'discover') {
      await this.applyDiscover(
        tx,
        userId,
        run,
        step,
        input as DiscoveryQuery,
        items as DiscoveredPlace[],
        costUsd,
        complete,
      );
    } else if (step.stage === 'find_people') {
      await this.applyPeople(
        tx,
        userId,
        run,
        step.id,
        input as PeopleStepInput,
        items as FoundPerson[],
      );
    } else if (step.stage === 'enrich') {
      await this.applyEmails(
        tx,
        userId,
        run,
        step.id,
        input as EmailStepInput,
        items as FoundEmail[],
      );
    }
  }

  // -------------------------------------------------------------------------------------
  // Stage results

  private async applyDiscover(
    tx: Queryable,
    userId: UserId,
    run: Run,
    step: RunStep,
    query: DiscoveryQuery,
    places: DiscoveredPlace[],
    costUsd: number,
    /** False for a failed, aborted or interrupted search: it says nothing about yield. */
    complete: boolean,
  ): Promise<void> {
    const cellId = step.regionCellId;
    let newPlaces = 0;
    let dropped = 0;
    let alreadyKnown = 0;
    let noContact = 0;
    const outline = await getRegionOutline(tx, run.region);
    for (const place of places) {
      // Spillage: a cell on the border also returns places from the neighbouring governorate.
      // Drop them before anything is stored, so they never reach (or cost) the paid stages.
      // A place with no coordinates cannot be judged and is kept.
      if (
        outline &&
        place.location &&
        !placeInOutline(place.location.lat, place.location.lng, outline)
      ) {
        dropped++;
        await this.note(
          tx,
          userId,
          step.id,
          `Dropped "${place.name.value}" (${place.location.lat.toFixed(5)}, ${place.location.lng.toFixed(5)}): outside ${run.region}`,
        );
        continue;
      }
      const refreshBy =
        place.provider === 'google_places'
          ? new Date(Date.now() + this.config.googleRefreshDays * 86_400_000)
          : undefined;
      const first = <T>(xs: T[]): T | undefined => xs[0];
      const phone = first(place.phones);
      const email = first(place.emails);
      // The cell sits inside the region's bounds; the governorate is inferred from it.
      const governorate: Sourced<string> = { ...place.name, value: run.region, kind: 'estimate' };
      // A company the user removed and the daily purge deleted leaves only a marker: skip it
      // instead of finding it (and paying for it) again.
      if (
        await isCompanyRemoved(tx, userId, {
          placeId: place.placeId?.value ?? null,
          name: place.name.value,
          phone: phone?.value ?? null,
          governorate: run.region,
        })
      ) {
        alreadyKnown++;
        continue;
      }
      const { company, created } = await upsertCompany(
        tx,
        userId,
        {
          name: place.name,
          governorate,
          googlePlaceId: place.placeId,
          ...(place.website ? { website: place.website } : {}),
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(place.linkedinUrl ? { linkedinUrl: place.linkedinUrl } : {}),
          sourceProvider: place.provider,
          ...(refreshBy ? { refreshBy } : {}),
          ...(cellId ? { regionCellId: cellId } : {}),
        },
        run.id,
      );
      if (created) newPlaces++;
      else alreadyKnown++;
      // The Maps photo is the fallback thumbnail; the website's own image replaces it later.
      if (created && place.imageUrl) await setMapsImage(tx, userId, company.id, place.imageUrl);
      if (created && !isReachable(place)) noContact++;
      // Only companies new to this user go through the paid stages; a company another run
      // (or an earlier one) already found is skipped here.
      await addRunCompany(tx, userId, {
        runId: run.id,
        companyId: company.id,
        regionCellId: cellId,
        isNew: created,
        state: created ? 'discovered' : 'skipped',
        payload: { place, querySectorId: query.sectorId },
      });
    }
    await addDroppedPlaces(tx, userId, run.id, dropped);
    const droppedReasons = (
      [
        ['outside_region', dropped],
        ['already_known', alreadyKnown],
        ['no_contact', noContact],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => ({ reason, count }));
    await setStepSummary(tx, userId, step.id, {
      returned: places.length,
      kept: places.length - dropped - alreadyKnown - noContact,
      dropped: droppedReasons,
    });
    await this.note(
      tx,
      userId,
      step.id,
      `Search "${query.textQuery}"${query.cellKey ? ` in area ${query.cellKey}` : ''}: ${places.length} places returned, ${newPlaces} new, ${dropped} outside the region, ${alreadyKnown} already known, ${noContact} with no contact detail, cost $${costUsd.toFixed(4)}`,
    );
    if (cellId && (complete || places.length > 0)) {
      await recordSearchQuery(tx, userId, {
        runId: run.id,
        runStepId: step.id,
        regionCellId: cellId,
        provider: this.deps.discovery.name,
        queryText: query.textQuery,
        sectorId: query.sectorId,
        requestsUsed: 1,
        resultsReturned: places.length,
        newPlacesFound: newPlaces,
        costUsd: Math.round(costUsd * 1e4) / 1e4,
      });
      await addCellCoverage(tx, userId, cellId, { placesFound: newPlaces, runAt: new Date() });
      if (complete && newPlaces < this.config.yieldFloor) {
        await markQueryExhausted(tx, userId, cellId, query.normalizedQuery);
      }
    }
  }

  private async applyPeople(
    tx: Queryable,
    userId: UserId,
    run: Run,
    stepId: string,
    input: PeopleStepInput,
    found: FoundPerson[],
  ): Promise<void> {
    const [rc] = await listRunCompanies(tx, userId, run.id, ['qualified']).then((rows) =>
      rows.filter((r) => r.companyId === input.companyId),
    );
    if (!rc) return;
    const payload = reviveDates<DiscoverPayload>(rc.payload);
    const identity = {
      name: payload.place.name.value,
      linkedinUrl: payload.place.linkedinUrl?.value ?? null,
    };
    const people: StoredPerson[] = [];
    const rejected: PeopleDiagnostics['rejected'] = [];
    for (const person of found) {
      const role = verifyCurrentRole(person.positions, identity, person.via);
      const title = await matchTitle(
        role.position?.title ?? person.headline?.value ?? '',
        (await this.classifierCapReached(userId, run.id)) ? undefined : this.deps.titleClassifier,
      );
      await this.recordLlmCosts(tx, userId, run.id, rc.regionCellId, title.costs);
      let contactId: string | null = null;
      let suppressed = false;
      let removed = false;
      if (title.roleClass && role.current) {
        removed = person.linkedinPublicId
          ? await isPersonRemoved(tx, userId, { linkedinPublicId: person.linkedinPublicId })
          : false;
      }
      if (title.roleClass && role.current && !removed) {
        const titleValue = role.position?.title ?? person.headline?.value ?? null;
        try {
          const { contact } = await upsertContact(
            tx,
            userId,
            {
              companyId: input.companyId,
              fullName: person.fullName,
              ...(titleValue ? { title: { ...person.linkedinUrl, value: titleValue } } : {}),
              roleClass: { ...person.linkedinUrl, value: title.roleClass, kind: title.kind },
              ...(person.linkedinPublicId
                ? { linkedinPublicId: { ...person.linkedinUrl, value: person.linkedinPublicId } }
                : {}),
              linkedinUrl: person.linkedinUrl,
              currentRoleVerified: {
                ...person.linkedinUrl,
                value: true,
                kind: role.position ? 'fact' : 'estimate',
              },
            },
            run.id,
          );
          contactId = contact.id;
          if (person.photoUrl) await setContactPhoto(tx, userId, contact.id, person.photoUrl);
        } catch (err) {
          if (!(err instanceof SuppressedContactError)) throw err;
          suppressed = true;
        }
      }
      if (!contactId) {
        const code: NoDecisionMakerReason = removed
          ? 'removed'
          : suppressed
            ? 'suppressed'
            : !title.roleClass
              ? 'no_matching_title'
              : 'not_current';
        const why = removed
          ? 'removed earlier from the CRM'
          : suppressed
            ? 'on the suppression list'
            : !title.roleClass
              ? `title not a decision-maker role (${title.method}: ${title.reasons.join('; ')})`
              : `not verified as current (${role.reason})`;
        rejected.push({
          name: person.fullName.value,
          headline: person.headline?.value ?? null,
          code,
          reason: why,
        });
      }
      people.push({ person, title, role, contactId, ...(suppressed ? { suppressed } : {}) });
    }
    const peopleDiagnostics: PeopleDiagnostics = {
      input: input.query,
      returned: found.length,
      kept: people.length - rejected.length,
      rejected,
    };
    this.deps.log?.(
      { runId: run.id, company: identity.name, ...peopleDiagnostics },
      'people step result',
    );
    const counts = new Map<NoDecisionMakerReason, number>();
    for (const r of rejected) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
    if (found.length === 0) counts.set('no_people_returned', 1);
    await setStepSummary(tx, userId, stepId, {
      returned: found.length,
      kept: peopleDiagnostics.kept,
      dropped: [],
      people: {
        found: found.length,
        decisionMakers: peopleDiagnostics.kept,
        noLinkedinPage: input.query.companyLinkedinUrl === null,
        reasons: [...counts].map(([reason, count]) => ({ reason, count })),
      },
    });
    await this.note(
      tx,
      userId,
      stepId,
      `People at ${identity.name}: ${found.length} returned, ${peopleDiagnostics.kept} kept as decision-makers`,
    );
    await moveRunCompany(tx, userId, {
      runId: run.id,
      companyId: input.companyId,
      from: 'qualified',
      to: 'people_found',
      payload: { people, peopleDiagnostics },
    });
  }

  private async applyEmails(
    tx: Queryable,
    userId: UserId,
    run: Run,
    stepId: string,
    input: EmailStepInput,
    found: FoundEmail[],
  ): Promise<void> {
    const byKey = new Map(found.map((e) => [e.key, e]));
    const perCompany = new Map<string, Record<string, FoundEmail>>();
    let withEmail = 0;
    for (const ref of input.refs) {
      const result = byKey.get(ref.key);
      const map = perCompany.get(ref.companyId) ?? {};
      perCompany.set(ref.companyId, map);
      if (!result) continue;
      map[ref.key] = result;
      if (
        result.email &&
        (result.status === 'valid' || result.status === 'catch_all' || result.status === 'unknown')
      ) {
        try {
          await setContactEmail(tx, userId, ref.contactId, result.email, run.id);
        } catch (err) {
          if (!(err instanceof SuppressedContactError)) throw err;
          map[ref.key] = { ...result, email: null, status: 'not_found', rawStatus: 'suppressed' };
          continue;
        }
        withEmail++;
      }
    }
    await setStepSummary(tx, userId, stepId, {
      returned: input.refs.length,
      kept: withEmail,
      dropped:
        input.refs.length > withEmail
          ? [{ reason: 'no_email_found', count: input.refs.length - withEmail }]
          : [],
    });
    await this.note(
      tx,
      userId,
      stepId,
      `Emails: ${withEmail} of ${input.refs.length} looked-up addresses found`,
    );
    for (const [companyId, emails] of perCompany) {
      await moveRunCompany(tx, userId, {
        runId: run.id,
        companyId,
        from: 'people_found',
        to: 'enriched',
        payload: { emails },
      });
    }
  }

  /** True once the Claude classifier has spent this run's classifier allowance. */
  private async classifierCapReached(userId: UserId, runId: string): Promise<boolean> {
    if (!this.deps.companyClassifier && !this.deps.titleClassifier) return false;
    const spent = await runSpendByProvider(this.db, userId, runId, 'anthropic');
    return spent >= this.config.classifierRunCapUsd;
  }

  /** What the classifier relied on and what it concluded, as estimates on the company. */
  private async recordClassifierEvidence(
    tx: Queryable,
    userId: UserId,
    runId: string,
    companyId: string,
    place: DiscoveredPlace,
    q: Qualification,
  ): Promise<void> {
    const at = new Date();
    for (const e of q.evidence) {
      await insertEvidence(
        tx,
        userId,
        { companyId },
        `classifier_${e.field}`,
        { value: e.value, sourceUrl: e.sourceUrl, fetchedAt: at, kind: 'estimate' },
        runId,
      );
    }
    await insertEvidence(
      tx,
      userId,
      { companyId },
      'classifier_verdict',
      {
        value: `${q.verdict}: ${q.reasons.join('; ')}`,
        sourceUrl: place.name.sourceUrl,
        fetchedAt: at,
        kind: 'estimate',
      },
      runId,
    );
  }

  private async recordLlmCosts(
    tx: Queryable,
    userId: UserId,
    runId: string,
    regionCellId: string | null,
    costs: CostEntry[],
  ): Promise<void> {
    for (const c of costs) {
      await recordCost(tx, userId, {
        runId,
        regionCellId,
        provider: c.provider,
        item: c.item,
        units: c.units,
        unitPriceUsd: c.unitPriceUsd,
        kind: 'actual',
      });
    }
  }

  // -------------------------------------------------------------------------------------
  // Planning paid stages

  /** One people search per qualified company, planned once (step keys are company IDs). */
  private async planPeople(userId: UserId, run: Run): Promise<boolean> {
    const planned = new Set(
      (await listSteps(this.db, userId, run.id))
        .filter((s) => s.stage === 'find_people')
        .map((s) => s.stepKey),
    );
    const todo = (await listRunCompanies(this.db, userId, run.id, ['qualified'])).filter(
      (rc) => !planned.has(rc.companyId),
    );
    if (todo.length === 0) return false;
    const keywords = titleKeywords();
    await withTransaction(this.db, async (tx) => {
      for (const rc of todo) {
        const payload = reviveDates<DiscoverPayload>(rc.payload);
        const query: PeopleQuery = {
          companyName: payload.place.name.value,
          companyLinkedinUrl: payload.place.linkedinUrl?.value ?? null,
          titleKeywords: keywords,
          location: 'Tunisia',
          maxPeople: this.config.maxPeoplePerCompany,
        };
        await ensureStep(tx, userId, {
          runId: run.id,
          stage: 'find_people',
          stepKey: rc.companyId,
          actorId: this.isApify(this.deps.people)
            ? query.companyLinkedinUrl
              ? 'harvestapi/linkedin-company-employees'
              : 'harvestapi/linkedin-profile-search'
            : null,
          provider: this.deps.people.name,
          regionCellId: rc.regionCellId,
          input: { companyId: rc.companyId, query } satisfies PeopleStepInput,
        });
      }
    });
    await this.checkpoint('find_people:planned');
    return true;
  }

  /**
   * Plans email lookups once, when find_people is done: every current decision-maker at a
   * company with a domain, in batches. Companies with nothing to look up move straight on.
   */
  private async planEmails(userId: UserId, run: Run): Promise<boolean> {
    const steps = (await listSteps(this.db, userId, run.id)).filter((s) => s.stage === 'enrich');
    const waiting = await listRunCompanies(this.db, userId, run.id, ['people_found']);
    if (steps.length > 0 || waiting.length === 0) return false;
    const refs: EmailStepInput['refs'] = [];
    const queries: EmailQuery[] = [];
    const noLookups: RunCompany[] = [];
    for (const rc of waiting) {
      const payload = reviveDates<DiscoverPayload>(rc.payload);
      const domain = payload.place.website ? normalizeDomain(payload.place.website.value) : null;
      let any = false;
      for (const p of payload.people ?? []) {
        const name = splitName(p.person.fullName.value);
        if (!domain || !p.contactId || !name) continue;
        const key = emailLookupKey(name.first, name.last, domain);
        refs.push({ key, companyId: rc.companyId, contactId: p.contactId });
        queries.push({ firstName: name.first, lastName: name.last, domain });
        any = true;
      }
      if (!any) noLookups.push(rc);
    }
    await withTransaction(this.db, async (tx) => {
      for (const rc of noLookups) {
        await moveRunCompany(tx, userId, {
          runId: run.id,
          companyId: rc.companyId,
          from: 'people_found',
          to: 'enriched',
          payload: { emails: {} },
        });
      }
      // Batches never split a company, so each company moves on with one batch.
      const size = this.config.emailBatchSize;
      let batch: EmailStepInput = { queries: [], refs: [] };
      let n = 0;
      const flush = async () => {
        if (batch.queries.length === 0) return;
        await ensureStep(tx, userId, {
          runId: run.id,
          stage: 'enrich',
          stepKey: `emails-${n++}`,
          actorId: this.isApify(this.deps.emails) ? this.deps.emails.name : null,
          provider: this.deps.emails.name,
          input: batch,
        });
        batch = { queries: [], refs: [] };
      };
      const byCompany = new Map<string, number[]>();
      refs.forEach((r, i) =>
        byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), i]),
      );
      for (const idx of byCompany.values()) {
        if (batch.queries.length + idx.length > size) await flush();
        for (const i of idx) {
          batch.queries.push(queries[i]!);
          batch.refs.push(refs[i]!);
        }
      }
      await flush();
    });
    await this.checkpoint('enrich:planned');
    if (queries.length > 0) {
      await this.say(this.db, userId, run.id, liveMessages.emails({ count: queries.length }));
    }
    return true;
  }

  // -------------------------------------------------------------------------------------
  // Pure stages

  private async runQualify(userId: UserId, run: Run): Promise<boolean> {
    const todo = await listRunCompanies(this.db, userId, run.id, ['discovered']);
    for (const rc of todo) {
      const payload = reviveDates<DiscoverPayload>(rc.payload);
      const capped = await this.classifierCapReached(userId, run.id);
      const q = await qualify(payload.place, {
        querySectorId: payload.querySectorId,
        ...(this.deps.companyClassifier && !capped
          ? { classifier: this.deps.companyClassifier }
          : {}),
        ...(this.deps.companyClassifier && capped
          ? {
              classifierSkipped:
                'classifier spend cap for this run reached; left for manual review',
            }
          : {}),
      });
      // A fit with no phone, website or email can't become a lead: kept, never scored.
      const unreachable = q.verdict === 'qualified' && !isReachable(payload.place);
      await withTransaction(this.db, async (tx) => {
        await this.recordLlmCosts(tx, userId, run.id, rc.regionCellId, q.costs);
        if (q.method === 'classifier') {
          await this.recordClassifierEvidence(tx, userId, run.id, rc.companyId, payload.place, q);
        }
        const moved = await moveRunCompany(tx, userId, {
          runId: run.id,
          companyId: rc.companyId,
          from: 'discovered',
          to: unreachable
            ? 'unreachable'
            : q.verdict === 'qualified'
              ? 'qualified'
              : q.verdict === 'rejected'
                ? 'rejected'
                : 'review',
          payload: { qualification: q },
        });
        if (!moved) return;
        if (q.verdict === 'qualified' && q.sectorId) {
          await setCompanySector(
            tx,
            userId,
            rc.companyId,
            { ...payload.place.name, value: q.sectorId, kind: q.kind },
            run.id,
          );
        }
        if (q.verdict === 'qualified' && !unreachable && rc.regionCellId) {
          await addCellCoverage(tx, userId, rc.regionCellId, { qualifiedCompanies: 1 });
        }
      });
      await this.checkpoint('qualify:company');
    }
    await this.moveStage(userId, run.id, 'qualify', 'find_people');
    return true;
  }

  /** Drops channels that were suppressed after they were found. */
  private async runVerify(userId: UserId, run: Run): Promise<boolean> {
    for (const rc of await listRunCompanies(this.db, userId, run.id, ['enriched'])) {
      const payload = reviveDates<DiscoverPayload>(rc.payload);
      const emails = { ...(payload.emails ?? {}) };
      for (const [key, e] of Object.entries(emails)) {
        if (e.email && (await findSuppressed(this.db, { email: e.email.value })).length > 0) {
          emails[key] = { ...e, email: null, status: 'not_found', rawStatus: 'suppressed' };
        }
      }
      await moveRunCompany(this.db, userId, {
        runId: run.id,
        companyId: rc.companyId,
        from: 'enriched',
        to: 'verified',
        payload: { emails },
      });
    }
    await this.moveStage(userId, run.id, 'verify', 'score');
    return true;
  }

  private async runScore(userId: UserId, run: Run): Promise<boolean> {
    for (const rc of await listRunCompanies(this.db, userId, run.id, ['verified'])) {
      const payload = reviveDates<DiscoverPayload>(rc.payload);
      const company: CompanyForLead = { ...payload.place, qualification: payload.qualification! };
      const domain = payload.place.website ? normalizeDomain(payload.place.website.value) : null;
      const people: (PersonForLead & { contactId: string })[] = [];
      for (const p of payload.people ?? []) {
        if (!p.contactId) continue;
        const name = splitName(p.person.fullName.value);
        const key = name && domain ? emailLookupKey(name.first, name.last, domain) : null;
        const email = key ? (payload.emails?.[key] ?? null) : null;
        people.push({
          person: p.person,
          title: p.title,
          role: p.role,
          email,
          contactId: p.contactId,
        });
      }
      // Companies whose suppressed or ineligible people leave no candidate still get a
      // company-only lead, with the company's own channel.
      const candidates = buildLeadCandidates(company, people, {
        maxPeople: this.config.maxLeadsPerCompany,
      });
      await withTransaction(this.db, async (tx) => {
        const scores = [];
        const feedback = await dismissalFeedback(tx, userId);
        for (const c of candidates) {
          const raw = score(c);
          const s = applyDismissalFeedback(raw, feedback, {
            sector: payload.qualification?.sectorId ?? null,
            roleClass: c.person
              ? (people.find((p) => p.person.linkedinUrl.value === c.person!.linkedinUrl.value)
                  ?.title.roleClass ?? null)
              : null,
          });
          const contactId = c.person
            ? (people.find((p) => p.person.linkedinUrl.value === c.person!.linkedinUrl.value)
                ?.contactId ?? null)
            : null;
          await upsertLead(tx, userId, {
            runId: run.id,
            companyId: rc.companyId,
            contactId,
            score: {
              companyFit: s.companyFit,
              contactFit: s.contactFit,
              reachability: s.reachability,
            },
            scoreReasons: [...raw.points, ...s.adjustments.map((a) => ({ ...a, evidence: [] }))],
          });
          scores.push({ contactId, total: s.total });
        }
        const moved = await moveRunCompany(tx, userId, {
          runId: run.id,
          companyId: rc.companyId,
          from: 'verified',
          to: 'scored',
          payload: { leads: scores },
        });
        if (moved && rc.regionCellId) {
          const withPerson = candidates.filter((c) => c.kind === 'person');
          await addCellCoverage(tx, userId, rc.regionCellId, {
            companiesWithDecisionMaker: withPerson.length > 0 ? 1 : 0,
            decisionMakersWithChannel: withPerson.some((c) => c.channel?.type !== 'linkedin')
              ? 1
              : 0,
            leadsFound: candidates.length,
          });
        }
      });
      await this.checkpoint('score:company');
    }
    const open = (await listRunCompanies(this.db, userId, run.id)).filter(
      (rc) => !TERMINAL_COMPANY.includes(rc.state),
    );
    if (open.length === 0) {
      await this.finish(userId, run.id, 'finished');
      return true;
    }
    return false;
  }

  private async finish(
    userId: UserId,
    runId: string,
    status: 'finished' | 'failed',
    error?: string,
  ): Promise<void> {
    const ended = await updateRun(this.db, userId, runId, {
      status,
      ...(error ? { error } : {}),
      onlyFrom: ['running', 'pending'],
    });
    if (ended) {
      await this.say(
        this.db,
        userId,
        runId,
        status === 'finished'
          ? liveMessages.done({ leads: (await runFunnel(this.db, userId, runId)).leads })
          : liveMessages.failed({ reason: error ?? null }),
        status === 'finished' ? 'info' : 'error',
      );
    }
    await releaseClaims(this.db, userId, runId);
    await this.checkpoint(`run:${status}`);
  }

  // -------------------------------------------------------------------------------------
  // Exhaustion and saturation

  /**
   * After discovery: a cell is exhausted when every wording in it has dropped below the yield
   * floor; a region is saturated when every one of its cells is exhausted.
   */
  private async evaluateExhaustion(userId: UserId, run: Run): Promise<void> {
    if (run.mode === 'maintenance') return;
    const exhausted = await listExhaustedQueries(this.db, userId, run.region);
    const byCell = new Map<string, Set<string>>();
    for (const e of exhausted) {
      byCell.set(e.regionCellId, (byCell.get(e.regionCellId) ?? new Set()).add(e.normalizedQuery));
    }
    for (const [cellId, wordings] of byCell) {
      if (ALL_WORDINGS.every((w) => wordings.has(w)))
        await markCellExhausted(this.db, userId, cellId);
    }
    const cells = await listCellStats(this.db, userId, run.region);
    if (cells.length > 0 && cells.every((c) => c.exhaustedAt !== null)) {
      await setRegionMode(this.db, userId, run.region, 'saturated');
    }
  }

  // -------------------------------------------------------------------------------------
  // Recovery, polling and webhooks

  /**
   * Startup recovery. For every user with unfinished work: re-attaches to each step still out
   * with Apify (asking Apify for its status and collecting finished datasets), closes
   * synchronous steps a crash interrupted, and moves every unfinished run forward.
   */
  async recover(): Promise<{ runs: number; stepsResumed: number }> {
    let runs = 0;
    let stepsResumed = 0;
    for (const userId of await listUsersWithUnfinishedWork(this.db)) {
      for (const runId of await listUnfinishedRunIds(this.db, userId)) {
        runs++;
        for (const step of await this.inFlightSteps(userId, runId)) {
          if (step.apifyRunId) {
            await this.event(this.db, userId, step.id, 'resumed', 'orchestrator restarted');
            stepsResumed++;
          }
        }
        await this.advance(userId, runId);
      }
    }
    return { runs, stepsResumed };
  }

  /** Backup poller: one pass over every unfinished run. Webhooks make it mostly a no-op. */
  async pollAll(): Promise<number> {
    let n = 0;
    for (const userId of await listUsersWithUnfinishedWork(this.db)) {
      for (const runId of await listUnfinishedRunIds(this.db, userId)) {
        await this.advance(userId, runId);
        n++;
      }
    }
    return n;
  }

  /** Handles an authenticated Apify webhook (see webhooks.ts) by advancing the step's run. */
  async onStepWebhook(userId: UserId, stepId: string): Promise<AdvanceResult | null> {
    const step = await getStep(this.db, userId, stepId);
    if (!step) return null;
    return this.advance(userId, step.runId);
  }

  /** How many runs the user has started: for the scheduler's explore rotation. */
  runCount(userId: UserId): Promise<number> {
    return countRuns(this.db, userId);
  }
}

export { normalizeQuery, STAGES, titleKeywords };
