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
import { useT } from '../i18n/index.js';
import { useResource } from '../lib/useResource.js';
import { AppShell } from './shared/AppShell.js';
import { ToastProvider } from './shared/Toast.js';

const ICON = 16;
const BADGE_POLL_MS = 15_000;

/** Wires the app frame to our strings and the signed-in user; Lead Gen pages get the sidebar. */
export function Layout() {
  const t = useT();
  const auth = useAuth();
  const api = useApi();
  const inLeadGen = useLocation().pathname.startsWith('/leadgen');

  // The counts beside "Dashboard" (leads waiting for a decision) and "Runs" (runs in progress).
  const waiting = useResource(() => api.leads.list({ stage: ['system_suggested'], limit: 1 }), {
    enabled: inLeadGen,
    pollMs: BADGE_POLL_MS,
  });
  const active = useResource(() => api.runs.list({ status: ['pending', 'running'], limit: 10 }), {
    enabled: inLeadGen,
    pollMs: BADGE_POLL_MS,
  });
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
        profileName={auth.user?.email ?? ''}
        profile={
          <button type="button" className="profile-signout" onClick={() => void auth.signOut()}>
            {t('nav.signOut')}
          </button>
        }
      >
        <HealthNotice />
        <Outlet />
      </AppShell>
    </ToastProvider>
  );
}
