import type { TradeCheckPreview, TradeCheckStatus, TradeRole } from '@lead-gen-crm/shared';
import { NOT_TRADING_ROLES, PROTECTED_STAGES, TRADING_ROLES } from '@lead-gen-crm/shared';
import { anthropicPrice } from '../config/pricing.js';
import { recordCost } from '../data/costLedger.js';
import { setCompanyTradeRole } from '../data/companies.js';
import { withTransaction, type Db, type Queryable } from '../data/db.js';
import { insertEvidence } from '../data/evidence.js';
import type { UserId } from '../data/ids.js';
import { getCountry } from '../config/countries.js';
import type { CompanyClassifier, CompanyFacts } from '../stages/classifier.js';

// "Check old leads for import/export": the classifier looks at companies found before the
// target changed, using what is already stored. It never calls Apify, so it costs only the
// classifier's tokens, which are capped. Companies the user has worked on are never touched.

/** A deliberately high size of one classifier call, so the estimate is never too low. */
const EST_INPUT_TOKENS = 450;
const EST_OUTPUT_TOKENS = 120;

const sqlList = (items: readonly string[]) => items.map((i) => `'${i}'`).join(', ');

/** Found-column companies nobody has worked on and nobody has labelled yet. */
const UNCHECKED_FROM = `
  FROM companies c
  JOIN crm_cards k ON k.company_id = c.id AND k.user_id = c.user_id
                  AND k.pipeline = 'companies' AND k.stage = 'found'
 WHERE c.user_id = $1 AND c.trade_role IS NULL
   AND NOT EXISTS (SELECT 1 FROM crm_cards w WHERE w.user_id = c.user_id AND w.company_id = c.id
                    AND w.stage IN (${sqlList(PROTECTED_STAGES)}))`;

interface Candidate {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  cardId: string;
  regionId: string;
  country: string;
  sourceUrl: string | null;
}

const idle = (capUsd: number): TradeCheckStatus => ({
  state: 'idle',
  total: 0,
  done: 0,
  yes: 0,
  noise: 0,
  unclear: 0,
  spentUsd: 0,
  capUsd,
  message: null,
});

interface Live {
  status: TradeCheckStatus;
  stop: boolean;
  finished: Promise<void>;
}

export class TradeChecker {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly db: Db,
    private readonly classifier: CompanyClassifier | undefined,
    private readonly capUsd: number,
    private readonly model = '',
  ) {}

  /** The most one call can cost, from the highest known price when the model is unknown. */
  private perCallUsd(): number {
    const p = anthropicPrice(this.model);
    return (EST_INPUT_TOKENS * p.input + EST_OUTPUT_TOKENS * p.output) / 1e6;
  }

  async preview(userId: UserId): Promise<TradeCheckPreview> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::integer AS n ${UNCHECKED_FROM}`,
      [userId],
    );
    const unchecked = rows[0]!.n;
    const per = this.perCallUsd();
    const affordable = Math.floor(this.capUsd / per);
    const willCheck = this.classifier ? Math.min(unchecked, affordable) : 0;
    return {
      unchecked,
      willCheck,
      estimatedCostUsd: Math.round(willCheck * per * 10_000) / 10_000,
      capUsd: this.capUsd,
      classifierConfigured: this.classifier !== undefined,
    };
  }

  status(userId: UserId): TradeCheckStatus {
    return this.live.get(userId)?.status ?? idle(this.capUsd);
  }

  /** Asks a running check to stop after the company it is on. */
  stop(userId: UserId): TradeCheckStatus {
    const live = this.live.get(userId);
    if (live && live.status.state === 'running') live.stop = true;
    return this.status(userId);
  }

  /** Resolves when the user's check has ended; for tests. */
  async whenFinished(userId: UserId): Promise<void> {
    await this.live.get(userId)?.finished;
  }

  /** Starts a check in the background; returns the status at once. One check per user at a time. */
  async start(userId: UserId): Promise<TradeCheckStatus> {
    const current = this.live.get(userId);
    if (current?.status.state === 'running') return current.status;
    if (!this.classifier) {
      return { ...idle(this.capUsd), state: 'failed', message: 'No classifier key is set.' };
    }
    const preview = await this.preview(userId);
    const live: Live = {
      status: { ...idle(this.capUsd), state: 'running', total: preview.willCheck },
      stop: false,
      finished: Promise.resolve(),
    };
    this.live.set(userId, live);
    if (preview.willCheck === 0) {
      live.status.state = 'finished';
      return live.status;
    }
    live.finished = this.run(userId, live, preview.willCheck).catch((err: unknown) => {
      live.status.state = 'failed';
      live.status.message = err instanceof Error ? 'The check stopped because of an error.' : null;
    });
    return live.status;
  }

  private async candidates(userId: UserId, limit: number): Promise<Candidate[]> {
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      category: string | null;
      website: string | null;
      card_id: string;
      governorate: string;
      country: string;
      source_url: string | null;
    }>(
      `SELECT c.id, c.name, c.category, c.website, k.id AS card_id, c.governorate, c.country,
              (SELECT e.source_url FROM evidence e WHERE e.company_id = c.id AND e.field = 'name'
                ORDER BY e.id LIMIT 1) AS source_url
         ${UNCHECKED_FROM}
        ORDER BY c.created_at, c.id LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      website: r.website,
      cardId: r.card_id,
      regionId: r.governorate,
      country: r.country,
      sourceUrl: r.source_url,
    }));
  }

  private async run(userId: UserId, live: Live, limit: number): Promise<void> {
    const list = await this.candidates(userId, limit);
    if (list.length === 0) {
      live.status.state = 'finished';
      return;
    }
    // The spend goes in the ledger like any run's, on a run of its own kind that is created
    // finished, so it is never resumed and never counts as a running run.
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO runs (user_id, region_id, kind, status, budget_cap_usd, started_at, finished_at)
       VALUES ($1, $2, 'trade_check', 'finished', $3, now(), now()) RETURNING id`,
      [userId, list[0]!.regionId, this.capUsd],
    );
    const runId = rows[0]!.id;
    for (const c of list) {
      if (live.stop) {
        live.status.state = 'stopped';
        live.status.message = 'Stopped. Nothing already checked is undone.';
        return;
      }
      if (live.status.spentUsd >= this.capUsd) {
        live.status.state = 'capped';
        live.status.message = 'The spending cap for this check was reached.';
        return;
      }
      const facts: CompanyFacts = {
        name: c.name,
        category: c.category,
        types: [],
        website: c.website,
        address: null,
        sourceUrl: c.sourceUrl ?? c.website ?? 'https://www.google.com/maps',
        // A company of a country that trades with a partner is asked about that partner.
        mode: getCountry(c.country).mode,
        ...(getCountry(c.country).partnerCountry
          ? { partnerCountry: getCountry(getCountry(c.country).partnerCountry).name }
          : {}),
      };
      const result = await this.classifier!.classifyCompany(facts);
      const role: TradeRole = result.tradeRole ?? 'unclear';
      const capped = await withTransaction(this.db, async (tx) => {
        let hitCap = false;
        for (const cost of result.costs) {
          const recorded = await recordCost(tx, userId, {
            runId,
            provider: cost.provider,
            item: cost.item,
            units: cost.units,
            unitPriceUsd: cost.unitPriceUsd,
            kind: 'actual',
          });
          live.status.spentUsd = recorded.runSpentUsd;
          if (recorded.monthCapUsd !== null && recorded.monthSpentUsd >= recorded.monthCapUsd) {
            hitCap = true;
          }
        }
        if (role !== 'unclear') {
          await setCompanyTradeRole(tx, userId, c.id, role);
          await this.writeEvidence(tx, userId, runId, c, result.reasons, result.evidence);
          if ((NOT_TRADING_ROLES as readonly string[]).includes(role)) {
            await this.toNoise(tx, userId, c);
          }
        }
        return hitCap;
      });
      live.status.done += 1;
      if (role === 'unclear') live.status.unclear += 1;
      else if ((TRADING_ROLES as readonly string[]).includes(role)) live.status.yes += 1;
      else live.status.noise += 1;
      if (capped) {
        live.status.state = 'capped';
        live.status.message = 'The monthly spending cap was reached.';
        return;
      }
    }
    live.status.state = 'finished';
  }

  private async writeEvidence(
    tx: Queryable,
    userId: UserId,
    runId: string,
    c: Candidate,
    reasons: readonly string[],
    evidence: readonly { field: string; value: string; sourceUrl: string }[],
  ): Promise<void> {
    const at = new Date();
    for (const e of evidence) {
      await insertEvidence(
        tx,
        userId,
        { companyId: c.id },
        `classifier_${e.field}`,
        { value: e.value, sourceUrl: e.sourceUrl, fetchedAt: at, kind: 'estimate' },
        runId,
      );
    }
    await insertEvidence(
      tx,
      userId,
      { companyId: c.id },
      'classifier_verdict',
      {
        value: reasons.join('; '),
        sourceUrl: c.sourceUrl ?? c.website ?? 'https://www.google.com/maps',
        fetchedAt: at,
        kind: 'estimate',
      },
      runId,
    );
  }

  /**
   * Same Noise as a removal (restorable, purged after the retention days), without the
   * "dismissed" feedback a person's own removal gives to scoring: nobody judged these leads.
   * Only a card still in Found moves, so work done while the check ran is never undone.
   */
  private async toNoise(tx: Queryable, userId: UserId, c: Candidate): Promise<void> {
    await tx.query(
      `UPDATE crm_cards SET stage = 'noise', noise_at = now(), noise_from_stage = stage,
              stage_entered_at = now(), updated_at = now()
        WHERE user_id = $1 AND id = $2 AND pipeline = 'companies' AND stage = 'found'`,
      [userId, c.cardId],
    );
  }
}
