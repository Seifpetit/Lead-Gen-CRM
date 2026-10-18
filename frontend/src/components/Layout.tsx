import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../features/auth/AuthContext.js';
import { useT } from '../i18n/index.js';

export function Layout() {
  const t = useT();
  // Lead Gen pages show the profile at the bottom of their sidebar instead.
  const sidebarHasProfile = useLocation().pathname.startsWith('/leadgen');
  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="topbar">
        <span className="brand">{t('app.name')}</span>
        <nav aria-label={t('nav.label')} className="topnav">
          <NavLink to="/leadgen">{t('nav.leadGen')}</NavLink>
          <NavLink to="/crm">{t('nav.crm')}</NavLink>
        </nav>
        {!sidebarHasProfile && <Profile />}
      </header>
      <Outlet />
    </>
  );
}

/** The signed-in user and sign out. */
export function Profile({ className = 'topbar-user' }: { className?: string }) {
  const t = useT();
  const auth = useAuth();
  return (
    <div className={className}>
      <span className="muted" title={t('nav.signedInAs', { email: auth.user?.email ?? '' })}>
        {auth.user?.email}
      </span>
      <button type="button" className="button" onClick={() => void auth.signOut()}>
        {t('nav.signOut')}
      </button>
    </div>
  );
}
