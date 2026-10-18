import { NavLink, Outlet } from 'react-router';
import { Profile } from '../../components/Layout.js';
import { useT } from '../../i18n/index.js';

/** The Lead Gen pages: a sidebar with the four sections, the profile at its bottom. */
export function LeadGenShell() {
  const t = useT();
  return (
    <div className="shell">
      <aside className="sidebar">
        <nav aria-label={t('side.label')}>
          <NavLink to="/leadgen" end>
            {t('side.dashboard')}
          </NavLink>
          <NavLink to="/leadgen/coverage">{t('side.coverage')}</NavLink>
          <NavLink to="/leadgen/costs">{t('side.costs')}</NavLink>
          <NavLink to="/leadgen/logs">{t('side.logs')}</NavLink>
        </nav>
        <Profile className="sidebar-profile" />
      </aside>
      <div className="shell-main">
        <Outlet />
      </div>
    </div>
  );
}
