import {
  Activity,
  CircleDollarSign,
  CircleHelp,
  LayoutDashboard,
  Map as MapIcon,
  Settings,
} from 'lucide-react';
import { Outlet, useLocation } from 'react-router';
import { useApi } from '../api/context.js';
import { useAuth } from '../features/auth/AuthContext.js';
import { HealthNotice } from '../features/leadgen/health/HealthNotice.js';
import { LiveBanner } from '../features/leadgen/live/LiveBanner.js';
import { CountryProvider, useCountry } from '../features/country/CountryContext.js';
import { CountrySwitch } from '../features/country/CountrySwitch.js';
import { GdprNotice } from '../features/country/GdprNotice.js';
import { useT } from '../i18n/index.js';
import { useResource } from '../lib/useResource.js';
import { AppShell } from './shared/AppShell.js';
import { ToastProvider } from './shared/Toast.js';

const ICON = 16;
const BADGE_POLL_MS = 15_000;

/** Wires the app frame to our strings and the signed-in user; Lead Gen pages get the sidebar. */
export function Layout() {
  return (
    <CountryProvider>
      <Frame />
    </CountryProvider>
  );
}

function Frame() {
  const { country, showsAll } = useCountry();
  const scopeKey = showsAll ? 'ALL' : country;
  const t = useT();
  const auth = useAuth();
  const api = useApi();
  const pathname = useLocation().pathname;
  const inLeadGen = pathname.startsWith('/leadgen');
  // The Coverage map has its own country picker, floating over the map.
  const onCoverage = pathname.startsWith('/leadgen/coverage');

  // The counts beside "Dashboard" (leads waiting for a decision) and "Runs" (runs in progress).
  const waiting = useResource(() => api.leads.list({ stage: ['system_suggested'], limit: 1 }), {
    enabled: inLeadGen,
    pollMs: BADGE_POLL_MS,
    deps: [scopeKey],
  });
  // Runs in progress count across countries: the limit of two at a time is for the whole app.
  const active = useResource(
    () => api.runs.list({ status: ['pending', 'running'], limit: 10, country: 'ALL' }),
    { enabled: inLeadGen, pollMs: BADGE_POLL_MS },
  );
  const newLeads = waiting.data?.total ?? 0;
  const activeRuns = active.data?.items.length ?? 0;

  return (
    <ToastProvider>
      <AppShell
        brand={t('app.name')}
        skipLabel={t('app.skipToContent')}
        topNavLabel={t('nav.label')}
        topNav={[
          { to: '/leadgen', label: t('nav.leadGen') },
          { to: '/crm', label: t('nav.crm') },
        ]}
        {...(inLeadGen
          ? {
              sideNavLabel: t('side.label'),
              collapseLabel: t('side.collapse'),
              expandLabel: t('side.expand'),
              sideNav: [
                {
                  id: 'overview',
                  items: [
                    {
                      to: '/leadgen',
                      label: t('side.dashboard'),
                      end: true,
                      icon: <LayoutDashboard size={ICON} aria-hidden="true" />,
                      badge: newLeads,
                      badgeLabel: t('side.badge.newLeads', { count: newLeads }),
                    },
                  ],
                },
                {
                  id: 'insight',
                  items: [
                    {
                      to: '/leadgen/coverage',
                      label: t('side.coverage'),
                      icon: <MapIcon size={ICON} aria-hidden="true" />,
                    },
                    {
                      to: '/leadgen/costs',
                      label: t('side.costs'),
                      icon: <CircleDollarSign size={ICON} aria-hidden="true" />,
                    },
                  ],
                },
                {
                  id: 'activity',
                  items: [
                    {
                      to: '/leadgen/runs',
                      label: t('side.runs'),
                      icon: <Activity size={ICON} aria-hidden="true" />,
                      badge: activeRuns,
                      badgeLabel: t('side.badge.activeRuns', { count: activeRuns }),
                    },
                  ],
                },
              ],
              sideFooter: [
                {
                  to: '/leadgen/settings',
                  label: t('side.settings'),
                  icon: <Settings size={ICON} aria-hidden="true" />,
                },
                {
                  to: '/leadgen/help',
                  label: t('side.help'),
                  icon: <CircleHelp size={ICON} aria-hidden="true" />,
                },
              ],
            }
          : {})}
        countrySwitch={onCoverage ? undefined : <CountrySwitch />}
        banner={<LiveBanner />}
        profileName={auth.user?.email ?? ''}
        profile={
          <button type="button" className="profile-signout" onClick={() => void auth.signOut()}>
            {t('nav.signOut')}
          </button>
        }
      >
        <HealthNotice />
        <GdprNotice />
        {/* A new key draws the page again for the other country: instant, no reload. */}
        <Outlet key={scopeKey} />
      </AppShell>
    </ToastProvider>
  );
}
