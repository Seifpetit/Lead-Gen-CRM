import { CRM_STAGES, type CrmStage, type Lead, type Page } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { LeadCard } from './LeadCard.js';

export const BOARD_STAGES: readonly CrmStage[] = [
  'system_suggested',
  'confirmed',
  'contacted',
  'response',
];
export const CLOSED_STAGES: readonly CrmStage[] = ['dismissed', 'won', 'lost', 'opted_out'];
const PAGE = 25;

interface Column {
  items: Lead[];
  total: number;
  next: number | null;
  loading: boolean;
  error: unknown;
}
type Board = Record<CrmStage, Column>;

const blank = (): Column => ({ items: [], total: 0, next: null, loading: true, error: null });
const emptyBoard = (): Board => Object.fromEntries(CRM_STAGES.map((s) => [s, blank()])) as Board;

export function CrmPage() {
  const t = useT();
  const api = useApi();
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [closedOpen, setClosedOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const patch = useCallback((stage: CrmStage, update: (c: Column) => Column) => {
    setBoard((b) => ({ ...b, [stage]: update(b[stage]) }));
  }, []);

  const loadStage = useCallback(
    async (stage: CrmStage, offset = 0) => {
      patch(stage, (c) => ({ ...c, loading: true, error: null }));
      try {
        const page: Page<Lead> = await api.leads.list({ stage: [stage], limit: PAGE, offset });
        patch(stage, (c) => ({
          items:
            offset === 0
              ? page.items
              : [...c.items, ...page.items.filter((l) => !c.items.some((x) => x.id === l.id))],
          total: page.total,
          next: page.nextOffset,
          loading: false,
          error: null,
        }));
      } catch (err) {
        patch(stage, (c) => ({ ...c, loading: false, error: err }));
      }
    },
    [api, patch],
  );

  useEffect(() => {
    for (const stage of CRM_STAGES) void loadStage(stage);
  }, [loadStage]);

  // A move takes the card out of its column and puts the server's copy at the top of the new one.
  const moved = useCallback(
    (from: CrmStage) => (lead: Lead, message: string | null) => {
      setNote(message);
      setBoard((b) => {
        if (lead.crmStage === from) {
          return {
            ...b,
            [from]: { ...b[from], items: b[from].items.map((l) => (l.id === lead.id ? lead : l)) },
          };
        }
        const source = b[from];
        const target = b[lead.crmStage];
        return {
          ...b,
          [from]: {
            ...source,
            items: source.items.filter((l) => l.id !== lead.id),
            total: Math.max(0, source.total - 1),
          },
          [lead.crmStage]: {
            ...target,
            items: [lead, ...target.items.filter((l) => l.id !== lead.id)],
            total: target.total + 1,
          },
        };
      });
    },
    [],
  );

  const loadedAll = CRM_STAGES.every((s) => !board[s].loading);
  const total = useMemo(() => CRM_STAGES.reduce((n, s) => n + board[s].total, 0), [board]);
  const closedCount = CLOSED_STAGES.reduce((n, s) => n + board[s].total, 0);
  const allFailed = CRM_STAGES.every((s) => board[s].error !== null);

  return (
    <main id="main" className="page">
      <h1>{t('crm.title')}</h1>
      <p className="muted">{t('crm.intro')}</p>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {!loadedAll && total === 0 && !allFailed ? (
        <LoadingState />
      ) : allFailed ? (
        <ErrorState
          error={board.system_suggested.error}
          onRetry={() => CRM_STAGES.forEach((s) => void loadStage(s))}
        />
      ) : (
        <>
          {total === 0 && (
            <EmptyState title={t('crm.empty.title')}>
              {t('crm.empty.body')} <Link to="/leadgen">{t('crm.empty.link')}</Link>
            </EmptyState>
          )}
          <div className="board" role="group" aria-label={t('crm.board.label')}>
            {BOARD_STAGES.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                column={board[stage]}
                onMoved={moved(stage)}
                onMore={() => void loadStage(stage, board[stage].next ?? 0)}
                onRetry={() => void loadStage(stage)}
              />
            ))}
          </div>
          <section className="closed" aria-label={t('crm.closed.title')}>
            <h2>
              <button
                type="button"
                className="disclosure"
                aria-expanded={closedOpen}
                aria-controls="closed-columns"
                onClick={() => setClosedOpen((o) => !o)}
              >
                {closedOpen ? t('crm.closed.hide') : t('crm.closed.show', { count: closedCount })}
              </button>
            </h2>
            <div id="closed-columns" hidden={!closedOpen} className="board board-closed">
              {CLOSED_STAGES.map((stage) => (
                <StageColumn
                  key={stage}
                  stage={stage}
                  column={board[stage]}
                  onMoved={moved(stage)}
                  onMore={() => void loadStage(stage, board[stage].next ?? 0)}
                  onRetry={() => void loadStage(stage)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function StageColumn({
  stage,
  column,
  onMoved,
  onMore,
  onRetry,
}: {
  stage: CrmStage;
  column: Column;
  onMoved: (lead: Lead, note: string | null) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const label = t(`crmStage.${stage}`);
  return (
    <section className="column" aria-label={label}>
      <h3>
        {label} <span className="count">{column.total}</span>
      </h3>
      {column.loading && column.items.length === 0 ? (
        <LoadingState />
      ) : column.error !== null && column.items.length === 0 ? (
        <ErrorState error={column.error} onRetry={onRetry} />
      ) : column.items.length === 0 ? (
        <p className="muted">{t('crm.column.empty')}</p>
      ) : (
        <>
          <ul className="cards">
            {column.items.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onMoved={onMoved} />
            ))}
          </ul>
          {column.error !== null && <ErrorState error={column.error} onRetry={onMore} />}
          {column.next !== null && (
            <>
              <p className="muted small">
                {t('crm.column.showing', { shown: column.items.length, total: column.total })}
              </p>
              <button
                type="button"
                className="button"
                disabled={column.loading}
                onClick={onMore}
                aria-label={t('crm.more', { stage: label })}
              >
                {t('common.showMore')}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
