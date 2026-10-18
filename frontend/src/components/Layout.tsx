import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../features/auth/AuthContext.js';
import { useT } from '../i18n/index.js';

export function Layout() {
  const t = useT();
  const auth = useAuth();
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
        <div className="topbar-user">
          <span className="muted" title={t('nav.signedInAs', { email: auth.user?.email ?? '' })}>
            {auth.user?.email}
          </span>
          <button type="button" className="button" onClick={() => void auth.signOut()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>
      <Outlet />
    </>
  );
}
