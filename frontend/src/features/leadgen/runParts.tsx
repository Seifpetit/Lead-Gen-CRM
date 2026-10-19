import type { ApifyState, RunStatus } from '@lead-gen-crm/shared';
import { useT } from '../../i18n/index.js';

export const ACTIVE_STATUSES: readonly RunStatus[] = ['pending', 'running'];
/** The server's limit on runs in progress at once (preview.limits.maxActiveRuns says the same). */
export const MAX_ACTIVE_RUNS = 2;
export const isActive = (status: RunStatus) => ACTIVE_STATUSES.includes(status);

export function StatusBadge({ status }: { status: RunStatus }) {
  const t = useT();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

/** Where the cost checkpoints sit along a run's spend cap, as shares of the cap. */
export const CHECKPOINTS = [0.25, 0.5, 0.75];

/** The state of one Apify run. */
export function StateBadge({ state }: { state: ApifyState | null }) {
  const t = useT();
  if (!state) return <span className="badge badge-none">{t('apify.stateNone')}</span>;
  return <span className={`badge badge-apify-${state}`}>{t(`apify.state.${state}`)}</span>;
}
