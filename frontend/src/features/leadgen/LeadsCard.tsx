import { CRM_STAGES, type CrmStage, type Lead } from '@lead-gen-crm/shared';
import { ListChecks, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Card } from '../../components/shared/Card.js';
import { EmptyState } from '../../components/shared/EmptyState.js';
import { Popover } from '../../components/shared/Popover.js';
import { Tabs } from '../../components/shared/Tabs.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { formatDay, safeHref } from '../../lib/format.js';
import { channelHref } from '../../lib/lead.js';
import { StageBadge } from '../crm/LeadActions.js';
import {
  applyView,
  foundAt,
  inTab,
  LEAD_SORTS,
  LEAD_TABS,
  leadChannel,
  SCORE_FILTERS,
  type LeadFilters,
} from './leadsView.js';

const COLUMNS = ['website', 'contact', 'found', 'score', 'description', 'stage'] as const;
type Column = (typeof COLUMNS)[number];
type Density = 'comfortable' | 'compact';

/** Stages a bulk move offers; opting someone out needs a written reason, so it is one lead at a time. */
const BULK_STAGES = CRM_STAGES.filter((s) => s !== 'opted_out');

export function leadPath(lead: Lead) {
  return `/leadgen/runs/${lead.runId}/leads/${lead.id}`;
}

/**
 * The recent leads, one row each: company, website, how to reach them, the day found, score and
 * a one-line description. Rows can be ticked, which reveals Bulk actions. Search, filter, sort
 * and tabs work on the leads already loaded.
 */
export function LeadsCard({
  leads,
  total,
  runStarted,
  sectorNames,
  onMove,
  onCreateRun,
}: {
  /** The loaded leads, with moves that are still saving already applied. */
  leads: readonly Lead[];
  /** How many the server has; more than `leads.length` when the list was cut short. */
  total: number;
  runStarted: ReadonlyMap<string, string>;
  sectorNames: ReadonlyMap<string, string>;
  onMove: (leads: readonly Lead[], stage: CrmStage) => void;
  onCreateRun: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const searchId = useId();
  const [filters, setFilters] = useState<LeadFilters>({
    tab: 'all',
    query: '',
    score: 'any',
    sort: 'newest',
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<ReadonlySet<Column>>(new Set(COLUMNS));
  const [density, setDensity] = useState<Density>('comfortable');

  const rows = useMemo(() => applyView(leads, filters, runStarted), [leads, filters, runStarted]);
  const rowIds = useMemo(() => new Set(rows.map((l) => l.id)), [rows]);

  // Only rows that are on screen stay ticked; a search or tab change drops the others.
  useEffect(() => {
    setSelected((current) => {
      const kept = [...current].filter((id) => rowIds.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [rowIds]);

  const patch = (change: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...change }));
  const chosen = rows.filter((l) => selected.has(l.id));
  const allTicked = rows.length > 0 && chosen.length === rows.length;
  const filtering = filters.query.trim() !== '' || filters.score !== 'any';

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleColumn = (column: Column) =>
    setShown((current) => {
      const next = new Set(current);
      if (!next.delete(column)) next.add(column);
      return next;
    });
  const bulk = (stage: CrmStage) => {
    onMove(chosen, stage);
    setSelected(new Set());
  };
  const openRow = (event: MouseEvent, lead: Lead) => {
    if ((event.target as HTMLElement).closest('a, button, input, label, select')) return;
    void navigate(leadPath(lead));
  };

  const col = (c: Column) => shown.has(c);
  const sectorOf = (lead: Lead) =>
    lead.company.sector ? (sectorNames.get(lead.company.sector) ?? lead.company.sector) : null;
  const describe = (lead: Lead) => {
    const sector = sectorOf(lead);
    return lead.contact
      ? t('leads.desc.person', {
          title: lead.contact.title,
          name: lead.contact.fullName,
          place: lead.company.governorate,
        })
      : t(sector ? 'leads.desc.company' : 'leads.desc.companyNoSector', {
          sector: sector ?? '',
          place: lead.company.governorate,
        });
  };

  const tabs = LEAD_TABS.map((id) => ({
    id,
    label: t(`leads.tab.${id}`),
    count: leads.filter((l) => inTab(l, id)).length,
  }));

  return (
    <Card
      title={t('leads.title')}
      className="leads-card"
      actions={
        <Popover
          label={t('leads.display')}
          icon={<SlidersHorizontal size={16} aria-hidden="true" />}
        >
          <fieldset className="popover-group">
            <legend>{t('leads.display.columns')}</legend>
            {COLUMNS.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={shown.has(c)} onChange={() => toggleColumn(c)} />
                {t(`leads.col.${c}`)}
              </label>
            ))}
          </fieldset>
          <fieldset className="popover-group">
            <legend>{t('leads.display.density')}</legend>
            {(['comfortable', 'compact'] as const).map((d) => (
              <label key={d} className="check">
                <input
                  type="radio"
                  name="density"
                  checked={density === d}
                  onChange={() => setDensity(d)}
                />
                {t(`leads.density.${d}`)}
              </label>
            ))}
          </fieldset>
        </Popover>
      }
    >
      {leads.length === 0 ? (
        <EmptyState
          title={t('leads.empty.title')}
          action={
            <button type="button" className="button button-primary" onClick={onCreateRun}>
              {t('dash.create')}
            </button>
          }
        />
      ) : (
        <>
          <div className="list-tools">
            <div className="search">
              <Search size={14} aria-hidden="true" />
              <label htmlFor={searchId} className="visually-hidden">
                {t('leads.search')}
              </label>
              <input
                id={searchId}
                type="search"
                value={filters.query}
                placeholder={t('leads.search.placeholder')}
                onChange={(e) => patch({ query: e.target.value })}
              />
            </div>
            <label className="inline-field">
              <span>{t('leads.filter.score')}</span>
              <select
                value={filters.score}
                onChange={(e) => patch({ score: e.target.value as LeadFilters['score'] })}
              >
                {SCORE_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {t(`leads.filter.score.${s}` as StringKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span>{t('leads.sort')}</span>
              <select
                value={filters.sort}
                onChange={(e) => patch({ sort: e.target.value as LeadFilters['sort'] })}
              >
                {LEAD_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`leads.sort.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Tabs
            label={t('leads.tabs')}
            tabs={tabs}
            value={filters.tab}
            onChange={(tab) => patch({ tab })}
          >
            {chosen.length > 0 && (
              <div className="bulk-bar" role="status">
                <span>{t('leads.selected', { count: chosen.length })}</span>
                <Popover
                  label={t('leads.bulk')}
                  showLabel
                  align="left"
                  icon={<ListChecks size={14} aria-hidden="true" />}
                >
                  {(close) => (
                    <div className="menu">
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          bulk('confirmed');
                        }}
                      >
                        {t('lead.confirm')}
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          bulk('dismissed');
                        }}
                      >
                        {t('lead.dismiss')}
                      </button>
                      <label className="menu-select">
                        <span className="visually-hidden">{t('leads.bulk.move')}</span>
                        <select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            close();
                            bulk(e.target.value as CrmStage);
                          }}
                        >
                          <option value="">{t('leads.bulk.move')}</option>
                          {BULK_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {t(`crmStage.${s}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </Popover>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setSelected(new Set())}
                >
                  {t('leads.clearSelection')}
                </button>
              </div>
            )}

            {rows.length === 0 ? (
              <EmptyState title={filtering ? t('leads.none.filtered') : t('leads.none.tab')}>
                {filtering && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => patch({ query: '', score: 'any' })}
                  >
                    {t('leads.clearFilters')}
                  </button>
                )}
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className={`lead-table density-${density}`}>
                  <caption className="visually-hidden">{t('leads.table')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="cell-check">
                        <input
                          type="checkbox"
                          aria-label={t('leads.selectAll')}
                          checked={allTicked}
                          onChange={() =>
                            setSelected(allTicked ? new Set() : new Set(rows.map((l) => l.id)))
                          }
                        />
                      </th>
                      <th scope="col">{t('leads.col.company')}</th>
                      {col('website') && <th scope="col">{t('leads.col.website')}</th>}
                      {col('contact') && <th scope="col">{t('leads.col.contact')}</th>}
                      {col('found') && <th scope="col">{t('leads.col.found')}</th>}
                      {col('score') && (
                        <th scope="col" className="num">
                          {t('leads.col.score')}
                        </th>
                      )}
                      {col('description') && <th scope="col">{t('leads.col.description')}</th>}
                      {col('stage') && <th scope="col">{t('leads.col.stage')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((lead) => {
                      const channel = leadChannel(lead);
                      const href = channel ? channelHref(channel) : null;
                      const site = safeHref(lead.company.website);
                      return (
                        <tr
                          key={lead.id}
                          className={selected.has(lead.id) ? 'is-selected' : ''}
                          onClick={(e) => openRow(e, lead)}
                        >
                          <td className="cell-check">
                            <input
                              type="checkbox"
                              aria-label={t('leads.select', { name: lead.company.name })}
                              checked={selected.has(lead.id)}
                              onChange={() => toggle(lead.id)}
                            />
                          </td>
                          <th scope="row" className="cell-company">
                            <Link to={leadPath(lead)}>{lead.company.name}</Link>
                          </th>
                          {col('website') && (
                            <td className="cell-site">
                              {site ? (
                                <a href={site} target="_blank" rel="noopener noreferrer">
                                  {lead.company.domain ?? site}
                                </a>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          )}
                          {col('contact') && (
                            <td>
                              {channel ? (
                                href ? (
                                  <a href={href}>{channel.value}</a>
                                ) : (
                                  channel.value
                                )
                              ) : (
                                <span className="muted">{t('leads.noContact')}</span>
                              )}
                            </td>
                          )}
                          {col('found') && (
                            <td className="nowrap">{formatDay(foundAt(lead, runStarted))}</td>
                          )}
                          {col('score') && <td className="num">{lead.score.total}</td>}
                          {col('description') && <td className="cell-desc">{describe(lead)}</td>}
                          {col('stage') && (
                            <td>
                              <StageBadge stage={lead.crmStage} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Tabs>
          {total > leads.length && (
            <p className="muted small">{t('leads.cutShort', { shown: leads.length, total })}</p>
          )}
        </>
      )}
    </Card>
  );
}
