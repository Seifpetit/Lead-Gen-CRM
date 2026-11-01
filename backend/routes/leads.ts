import type { Lead, ObjectionResult, Page } from '@lead-gen-crm/shared';
import { CRM_STAGES } from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { getLead, moveLead, recordObjection } from '../data/crmLeads.js';
import { listLeadIds, loadLeads } from '../data/views.js';
import type { RouteDeps } from './deps.js';
import {
  ApiError,
  body,
  CountryParam,
  csvList,
  notFound,
  PageQuery,
  query,
  toPage,
  uuidParam,
  UUID,
} from './http.js';

const Reason = z.string().trim().min(1).max(500);

const LeadQuery = PageQuery.extend({
  stage: csvList(z.enum(CRM_STAGES)),
  runId: UUID.optional(),
  regionId: z.string().min(1).max(60).optional(),
  country: CountryParam,
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

const MoveBody = z.object({ stage: z.enum(CRM_STAGES), reason: Reason.optional() }).strict();
const ObjectionBody = z.object({ reason: Reason }).strict();

export async function leadRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;

  async function loadOne(user: ReturnType<typeof currentUser>['id'], id: string): Promise<Lead> {
    const [lead] = await loadLeads(db, user, [id]);
    if (!lead) throw notFound();
    return lead;
  }

  app.get('/api/leads', async (request): Promise<Page<Lead>> => {
    const user = currentUser(request).id;
    const q = query(LeadQuery, request);
    const { limit, offset, ...filter } = q;
    const { ids, total } = await listLeadIds(
      db,
      user,
      Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)),
      { limit, offset },
    );
    return toPage(await loadLeads(db, user, ids), total, q);
  });

  app.get('/api/leads/:id', async (request): Promise<Lead> => {
    return loadOne(currentUser(request).id, uuidParam(request, 'id'));
  });

  // Moves a lead between CRM stages. Dismissing keeps the lead (so it can't come back as a new
  // suggestion) and feeds the next scoring runs. Opted out is an objection and is final.
  app.patch('/api/leads/:id/stage', async (request): Promise<Lead> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const input = body(MoveBody, request);
    const current = await getLead(db, user, id);
    if (!current) throw notFound();

    if (input.stage === 'opted_out') {
      if (!input.reason) {
        throw new ApiError(
          400,
          'invalid_request',
          'Opting a lead out records an objection: give a reason',
          {
            issues: [{ path: 'reason', message: 'Required when the stage is opted_out' }],
          },
        );
      }
      const done = await recordObjection(db, user, id, input.reason);
      if (!done) throw notFound();
      return loadOne(user, id);
    }
    if (current.stage === 'opted_out') {
      throw new ApiError(409, 'opted_out_is_final', 'An objection cannot be undone from the CRM');
    }
    await moveLead(db, user, id, input.stage);
    return loadOne(user, id);
  });

  app.post('/api/leads/:id/objection', async (request): Promise<ObjectionResult> => {
    const user = currentUser(request).id;
    const id = uuidParam(request, 'id');
    const { reason } = body(ObjectionBody, request);
    const done = await recordObjection(db, user, id, reason);
    if (!done) throw notFound();
    return { lead: await loadOne(user, id), suppressed: done.suppressed };
  });
}
