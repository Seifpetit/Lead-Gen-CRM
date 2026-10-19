import {
  CRM_STAGES,
  CSV_DELIMITERS,
  EXPORT_FORMATS,
  EXPORT_PDF_MAX_ROWS,
  regionLabel,
  type CrmPipeline,
  type ExportFormat,
  type CsvDelimiter,
} from '@lead-gen-crm/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import { BoardError, listStages } from '../data/crmBoards.js';
import {
  cardExportRows,
  LEAD_STAGE_NAMES,
  leadExportRows,
  type ExportData,
} from '../data/exports.js';
import { exportFileName } from '../exports/columns.js';
import { toCsv } from '../exports/csv.js';
import { toPdf } from '../exports/pdf.js';
import { toXlsx } from '../exports/xlsx.js';
import type { RouteDeps } from './deps.js';
import { ApiError, csvList, parse, UUID } from './http.js';

// Downloads of the leads a panel shows, with the panel's filters: CSV, Excel or a PDF table.
// Built here so a large export never has to pass through the browser a page at a time.

const Format = z.object({
  format: z.enum(EXPORT_FORMATS),
  delimiter: z.enum(CSV_DELIMITERS).default('comma'),
});

const CardsExportQuery = Format.extend({
  q: z.string().trim().max(100).optional(),
  sector: z.string().trim().min(1).max(60).optional(),
  minScore: z.coerce.number().int().min(0).max(1000).optional(),
  foundDays: z.coerce.number().int().min(1).max(3650).optional(),
  runId: z.uuid().optional(),
  regionId: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(['newest', 'score', 'days', 'name', 'sector', 'stage']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  stage: z.string().min(1).max(40).optional(),
  excludeNoise: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const LeadsExportQuery = Format.extend({
  runIds: csvList(UUID),
  stage: csvList(z.enum(CRM_STAGES)),
  regionId: z.string().min(1).max(60).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

const PipelineParam = z.object({ pipeline: z.enum(['companies', 'people']) });

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const sectorName = (id: string) => FREIGHT_SECTORS.find((s) => s.id === id)?.name ?? id;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function send(
  reply: FastifyReply,
  data: ExportData,
  format: ExportFormat,
  delimiter: CsvDelimiter,
  meta: { title: string; filters: string[] },
): Promise<FastifyReply> {
  const now = new Date();
  const file =
    format === 'csv'
      ? toCsv(data.rows, delimiter)
      : format === 'xlsx'
        ? await toXlsx(data.rows, now)
        : await toPdf(data.rows, {
            title: meta.title,
            filters: meta.filters.join(' · '),
            total: data.total,
            now,
          });
  const shown =
    format === 'pdf' ? Math.min(data.rows.length, EXPORT_PDF_MAX_ROWS) : data.rows.length;
  return reply
    .header('content-type', CONTENT_TYPES[format])
    .header('content-disposition', `attachment; filename="${exportFileName(format, now)}"`)
    .header('cache-control', 'no-store')
    .header('x-export-rows', String(shown))
    .header('x-export-total', String(data.total))
    .send(file);
}

export async function exportRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, noiseRetentionDays } = deps;

  // The cards of a board or of the dashboard's leads panel, with that view's filters and sort.
  app.get('/api/exports/cards/:pipeline', async (request, reply) => {
    const { pipeline } = parse(PipelineParam, request.params) as { pipeline: CrmPipeline };
    const { format, delimiter, ...filters } = parse(CardsExportQuery, request.query);
    const user = currentUser(request).id;
    let data: ExportData;
    try {
      data = await cardExportRows(db, user, pipeline, noiseRetentionDays, filters);
    } catch (err) {
      if (err instanceof BoardError) throw new ApiError(400, err.code, err.message);
      throw err;
    }
    const stages = await listStages(db, pipeline);
    const said: string[] = [pipeline === 'companies' ? 'Companies' : 'People'];
    if (filters.q) said.push(`Search: ${filters.q}`);
    if (filters.stage) {
      said.push(`Stage: ${stages.find((s) => s.key === filters.stage)?.name ?? filters.stage}`);
    } else if (filters.excludeNoise) {
      said.push('Noise left out');
    }
    if (filters.sector) said.push(`Sector: ${sectorName(filters.sector)}`);
    if (filters.minScore) said.push(`Score ${filters.minScore} or more`);
    if (filters.foundDays) said.push(`Found in the last ${filters.foundDays} days`);
    if (filters.regionId) said.push(`Region: ${regionLabel(filters.regionId)}`);
    if (filters.runId) said.push('One run');
    return send(reply, data, format, delimiter, { title: 'Leads', filters: said });
  });

  // The scored leads of runs, as the Runs page lists them.
  app.get('/api/exports/leads', async (request, reply) => {
    const { format, delimiter, ...filter } = parse(LeadsExportQuery, request.query);
    const data = await leadExportRows(db, currentUser(request).id, filter);
    const said: string[] = [];
    const runs = filter.runIds?.length ?? 0;
    if (runs > 0) said.push(`${runs} ${plural(runs, 'run', 'runs')}`);
    if (filter.q) said.push(`Search: ${filter.q}`);
    if (filter.stage?.length) {
      said.push(`Stage: ${filter.stage.map((s) => LEAD_STAGE_NAMES[s]).join(', ')}`);
    }
    if (filter.minScore) said.push(`Score ${filter.minScore} or more`);
    if (filter.regionId) said.push(`Region: ${regionLabel(filter.regionId)}`);
    return send(reply, data, format, delimiter, { title: 'Run results', filters: said });
  });
}
