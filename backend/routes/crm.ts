import {
  BOARD_PAGE_SIZE,
  type AddDecisionMakerResult,
  type CrmBoard,
  type CrmCard,
  type CrmCardPage,
} from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import {
  addDecisionMaker,
  BoardError,
  getCard,
  listCards,
  loadBoard,
  moveCard,
  removeCard,
  restoreCard,
} from '../data/crmBoards.js';
import { matchTitleByRules } from '../stages/matchTitle.js';
import type { RouteDeps } from './deps.js';
import { ApiError, body, notFound, parse, uuidParam } from './http.js';

const Reason = z.string().trim().min(1).max(500);
const MoveBody = z.object({ stage: z.string().min(1).max(40), reason: Reason.optional() }).strict();
const RestoreBody = z.object({ stage: z.string().min(1).max(40).optional() }).strict();

/** A blank form field means "not given". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

const LinkedinUrl = z
  .url({ protocol: /^https?$/ })
  .max(300)
  .refine(
    (u) => /(^|\.)linkedin\.com$/i.test(new URL(u).hostname),
    'Must be a linkedin.com address',
  );

const DecisionMakerBody = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    title: optional(z.string().trim().max(200)),
    email: optional(z.email().max(200)),
    phone: optional(z.string().trim().max(40)),
    linkedinUrl: optional(LinkedinUrl),
  })
  .strict()
  .refine((v) => Boolean(v.email ?? v.phone ?? v.linkedinUrl), {
    path: ['email'],
    message: 'Give at least one of email, phone or LinkedIn',
  });

/** The toolbar: search words, sector, minimum score and sort, all read by the server. */
const FilterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sector: z.string().trim().min(1).max(60).optional(),
  minScore: z.coerce.number().int().min(0).max(1000).optional(),
  sort: z.enum(['newest', 'score', 'days', 'name', 'sector', 'stage']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(BOARD_PAGE_SIZE),
});
const CardsQuery = FilterQuery.extend({
  stage: z.string().min(1).max(40).optional(),
  cursor: z.string().min(1).max(300).optional(),
  excludeNoise: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
const PipelineParam = z.object({ pipeline: z.enum(['companies', 'people']) });

const BOARD_STATUS: Record<BoardError['code'], number> = {
  not_found: 404,
  invalid_stage: 400,
  invalid_cursor: 400,
  invalid_decision_maker: 400,
  reason_required: 400,
  decision_maker_required: 409,
  opted_out_is_final: 409,
  in_noise: 409,
  not_in_noise: 409,
  suppressed: 409,
};

/** Board refusals keep their code; the rest of the error handling is the app's. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BoardError) {
      if (err.code === 'not_found') throw notFound();
      throw new ApiError(BOARD_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
}

export async function crmRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, noiseRetentionDays: days } = deps;

  // A board: its columns with true totals and a first page each. Filters and sort apply to all.
  app.get('/api/crm/:pipeline', async (request): Promise<CrmBoard> => {
    const { pipeline } = parse(PipelineParam, request.params);
    const { limit, ...filters } = parse(FilterQuery, request.query);
    return guard(() => loadBoard(db, currentUser(request).id, pipeline, days, filters, limit));
  });

  // More cards: the next page of a column (or of the whole board, for the table view).
  app.get('/api/crm/:pipeline/cards', async (request): Promise<CrmCardPage> => {
    const { pipeline } = parse(PipelineParam, request.params);
    const options = parse(CardsQuery, request.query);
    return guard(() => listCards(db, currentUser(request).id, pipeline, days, options));
  });

  async function reload(user: ReturnType<typeof currentUser>['id'], id: string): Promise<CrmCard> {
    const card = await getCard(db, user, id, days);
    if (!card) throw notFound();
    return card;
  }

  // Moves a card to a column. Reaching a company's last column needs a decision-maker (use the
  // route below); Opted out needs a reason and is final; Noise is a removal.
  app.post('/api/crm/cards/:id/move', async (request): Promise<CrmCard> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const { stage, reason } = body(MoveBody, request);
    await guard(() => moveCard(db, user, id, stage, { reason }));
    return reload(user, id);
  });

  // Names the decision-maker: stores the person, adds their card to People (New) and moves the
  // company to Decision-maker identified, all or nothing.
  app.post(
    '/api/crm/cards/:id/decision-maker',
    async (request, reply): Promise<AddDecisionMakerResult> => {
      const user = currentUser(request).id;
      const id = uuidParam(request, 'id');
      const input = body(DecisionMakerBody, request);
      const roleClass = input.title ? matchTitleByRules(input.title).roleClass : null;
      const result = await guard(() =>
        addDecisionMaker(db, user, id, { ...input, roleClass }, days),
      );
      reply.code(201);
      return result;
    },
  );

  // Remove: to Noise, and the dismissal feeds back into scoring.
  app.post('/api/crm/cards/:id/remove', async (request): Promise<CrmCard> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    await guard(() => removeCard(db, user, id));
    return reload(user, id);
  });

  app.post('/api/crm/cards/:id/restore', async (request): Promise<CrmCard> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const { stage } = parse(RestoreBody, request.body);
    await guard(() => restoreCard(db, user, id, stage));
    return reload(user, id);
  });
}
