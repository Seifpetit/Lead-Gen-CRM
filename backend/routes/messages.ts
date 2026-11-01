import {
  CONTACT_CHANNELS,
  MAX_SENDER_FIELD_LENGTH,
  MAX_TEMPLATE_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  TEMPLATE_LANGUAGES,
  type MessageTemplate,
  type SenderProfile,
} from '@lead-gen-crm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { BoardError, recordContact } from '../data/crmBoards.js';
import {
  createTemplate,
  deleteTemplate,
  getSenderProfile,
  listTemplates,
  setSenderProfile,
  TemplateLimitError,
  updateTemplate,
} from '../data/messageTemplates.js';
import type { RouteDeps } from './deps.js';
import { ApiError, body, notFound, uuidParam, UUID } from './http.js';

// Message templates (Settings), who the messages come from, and the note that a conversation
// was opened from the app. Nothing here sends a message: the person sends it in WhatsApp.

const TemplateBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME_LENGTH),
    language: z.enum(TEMPLATE_LANGUAGES).optional(),
    // Kept as typed (Arabic, line breaks); only blank text is refused.
    body: z
      .string()
      .max(MAX_TEMPLATE_LENGTH)
      .refine((v) => v.trim() !== '', 'Required'),
  })
  .strict();

const SenderBody = z
  .object({
    name: z.string().trim().max(MAX_SENDER_FIELD_LENGTH),
    company: z.string().trim().max(MAX_SENDER_FIELD_LENGTH),
  })
  .strict();

const ContactBody = z
  .object({
    channel: z.enum(CONTACT_CHANNELS),
    companyId: UUID,
    personId: UUID.nullable().optional(),
  })
  .strict();

export async function messageRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;

  app.get('/api/templates', async (request): Promise<{ items: MessageTemplate[] }> => ({
    items: await listTemplates(db, currentUser(request).id),
  }));

  app.post('/api/templates', async (request, reply): Promise<MessageTemplate> => {
    const input = body(TemplateBody, request);
    try {
      const created = await createTemplate(db, currentUser(request).id, input);
      reply.code(201);
      return created;
    } catch (err) {
      if (err instanceof TemplateLimitError) {
        throw new ApiError(409, 'too_many_templates', err.message);
      }
      throw err;
    }
  });

  app.put('/api/templates/:id', async (request): Promise<MessageTemplate> => {
    const id = uuidParam(request, 'id');
    const saved = await updateTemplate(
      db,
      currentUser(request).id,
      id,
      body(TemplateBody, request),
    );
    if (!saved) throw notFound();
    return saved;
  });

  app.delete('/api/templates/:id', async (request, reply) => {
    const id = uuidParam(request, 'id');
    if (!(await deleteTemplate(db, currentUser(request).id, id))) throw notFound();
    return reply.code(204).send();
  });

  app.get('/api/profile/sender', async (request): Promise<SenderProfile> =>
    getSenderProfile(db, currentUser(request).id),
  );

  app.put('/api/profile/sender', async (request): Promise<SenderProfile> =>
    setSenderProfile(db, currentUser(request).id, body(SenderBody, request)),
  );

  // "WhatsApp opened for Amel": a line on the card, written when the person clicks Open.
  app.post('/api/crm/contacts', async (request, reply): Promise<{ at: string }> => {
    const { channel, companyId, personId } = body(ContactBody, request);
    try {
      const done = await recordContact(
        db,
        currentUser(request).id,
        { companyId, personId: personId ?? null },
        channel,
      );
      reply.code(201);
      return done;
    } catch (err) {
      if (err instanceof BoardError && err.code === 'not_found') throw notFound();
      throw err;
    }
  });
}
