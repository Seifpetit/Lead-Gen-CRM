import {
  checkpointCounts,
  checkpointState,
  CHECKPOINT_IDS,
  type CheckpointId,
  type RunProgress,
  type RunFunnel,
} from '@lead-gen-crm/shared';
import { Building2, Check, Flag, Gauge, Mail, Search, Users, type LucideIcon } from 'lucide-react';
import { useT, type StringKey } from '../../../i18n/index.js';
import { formatNumber } from '../../../lib/format.js';
import './live.css';

export const CHECKPOINT_ICONS: Record<CheckpointId, LucideIcon> = {
  searching: Search,
  checking: Building2,
  people: Users,
  contacts: Mail,
  scoring: Gauge,
  done: Flag,
};

/**
 * The six checkpoints of a run in order, each with its count. A finished checkpoint is solid, the
 * one being worked on pulses, the rest are outlined; a stopped run marks where it stopped. The
 * state is also written out for screen readers, so colour is never the only signal.
 */
export function Checkpoints({
  funnel,
  progress,
  halted = false,
  compact = false,
}: {
  funnel: RunFunnel;
  progress: RunProgress;
  /** The run ended before the last checkpoint (stopped, failed or out of budget). */
  halted?: boolean;
  /** Icons and counts only, for a run in a list. */
  compact?: boolean;
}) {
  const t = useT();
  const counts = checkpointCounts(funnel);
  return (
    <ol className={compact ? 'cp-list is-compact' : 'cp-list'} aria-label={t('cp.list')}>
      {CHECKPOINT_IDS.map((id) => {
        const state = checkpointState(progress, id);
        const shown = state === 'current' && halted ? 'halted' : state;
        const Icon = CHECKPOINT_ICONS[id];
        const showCount = state !== 'todo';
        return (
          <li key={id} className="cp" data-state={shown} title={t(`cp.${id}` as StringKey)}>
            <span className="cp-icon" aria-hidden="true">
              {state === 'done' && id !== 'done' ? (
                <Check size={16} strokeWidth={3} />
              ) : (
                <Icon size={16} />
              )}
            </span>
            <span className="cp-text">
              <span className="cp-label">{t(`cp.${id}` as StringKey)}</span>
              <span className="cp-count" aria-hidden={showCount ? undefined : 'true'}>
                {showCount
                  ? t(`cp.count.${id}` as StringKey, { count: formatNumber(counts[id]) })
                  : '—'}
              </span>
              <span className="visually-hidden">{t(`cp.state.${shown}` as StringKey)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
