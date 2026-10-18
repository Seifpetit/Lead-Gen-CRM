import { Outlet, useLocation } from 'react-router';
import { useAuth } from '../features/auth/AuthContext.js';
import { useT } from '../i18n/index.js';
import { AppShell } from './shared/AppShell.js';

/** Wires the app frame to our strings and the signed-in user; Lead Gen pages get the sidebar. */
export function Layout() {
  const t = useT();
  const auth = useAuth();
  const inLeadGen = useLocation().pathname.startsWith('/leadgen');
  return (
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
            sideNav: [
              { to: '/leadgen', label: t('side.dashboard'), end: true },
              { to: '/leadgen/coverage', label: t('side.coverage') },
              { to: '/leadgen/costs', label: t('side.costs') },
              { to: '/leadgen/logs', label: t('side.logs') },
            ],
          }
        : {})}
      profile={
        <>
          <span className="muted" title={t('nav.signedInAs', { email: auth.user?.email ?? '' })}>
            {auth.user?.email}
          </span>
          <button type="button" className="button" onClick={() => void auth.signOut()}>
            {t('nav.signOut')}
          </button>
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
