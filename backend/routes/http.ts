import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Page } from '@lead-gen-crm/shared';

/** A handled failure: the status, a stable code for clients, and optional details. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'not_found') => new ApiError(404, what);

/** Parses with a schema or throws a 400 listing each problem by path. Never echoes values. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw new ApiError(400, 'invalid_request', 'The request did not match the expected shape', {
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

export const body = <S extends z.ZodType>(schema: S, request: FastifyRequest) =>
  parse(schema, request.body);
export const query = <S extends z.ZodType>(schema: S, request: FastifyRequest) =>
  parse(schema, request.query);

export const UUID = z.uuid();
/** Route params that must be UUIDs; anything else is a 404 so IDs can't be probed. */
export function uuidParam(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, string>)[name];
  const ok = UUID.safeParse(value);
  if (!ok.success) throw notFound();
  return ok.data;
}

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function toPage<T>(items: T[], total: number, page: PageQuery): Page<T> {
  const next = page.offset + items.length;
  return {
    items,
    total,
    limit: page.limit,
    offset: page.offset,
    nextOffset: items.length > 0 && next < total ? next : null,
  };
}

/** "a,b" or repeated ?x=a&x=b into a list, for filters. */
export const csvList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).filter((x) => x !== ''),
    z.array(item).optional(),
  );
