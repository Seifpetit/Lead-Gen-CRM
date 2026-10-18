import type { FastifyInstance } from 'fastify';
import { getLead } from '../data/crmLeads.js';
import type { Db } from '../data/db.js';
import { getRun } from '../data/runs.js';
import { currentUser } from '../auth/plugin.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimal reads so auth can be tested end to end; pass 5 builds the full API.
// Another user's ID and a nonexistent ID both return 404, so IDs can't be probed.
export async function recordRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const id = request.params.id;
    const run = UUID.test(id) ? await getRun(db, currentUser(request).id, id) : null;
    return run ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get<{ Params: { id: string } }>('/api/leads/:id', async (request, reply) => {
    const id = request.params.id;
    const lead = UUID.test(id) ? await getLead(db, currentUser(request).id, id) : null;
    return lead ?? reply.code(404).send({ error: 'not_found' });
  });
}
