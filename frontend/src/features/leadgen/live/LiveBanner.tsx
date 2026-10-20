import { useLocation } from 'react-router';
import { useLiveRuns } from '../../../lib/useLiveRuns.js';
import { LiveStrip } from './LiveStrip.js';

/** The Runs page shows every run in full, so the banner stays away from it. */
export const hidesBanner = (pathname: string) =>
  pathname === '/leadgen/runs' || pathname.startsWith('/leadgen/runs/');

/**
 * The live run banner, fixed under the app's top bar so it shows on every page (Dashboard,
 * Coverage, Costs, Settings, Help, the CRM) while a run is going, and on none of the Runs page.
 * It keeps its own live feed, so it stays current wherever the person is.
 */
export function LiveBanner() {
  const live = useLiveRuns();
  const { pathname } = useLocation();
  if (hidesBanner(pathname)) return null;
  return (
    <LiveStrip
      runs={live.runs ?? []}
      ended={live.ended}
      mode={live.mode}
      unreachable={live.error !== null}
    />
  );
}
