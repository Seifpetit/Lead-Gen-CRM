import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface NavItem {
  to: string;
  label: string;
  /** Match this link only on its exact address. */
  end?: boolean;
}

/**
 * The frame around every page: a top bar with the brand and main tabs, and an optional sidebar
 * with the profile at its bottom. Without a sidebar the profile sits in the top bar instead.
 */
export function AppShell({
  brand,
  skipLabel,
  topNav,
  topNavLabel,
  sideNav,
  sideNavLabel,
  profile,
  children,
}: {
  brand: string;
  skipLabel: string;
  topNav: readonly NavItem[];
  topNavLabel: string;
  sideNav?: readonly NavItem[];
  sideNavLabel?: string;
  /** The signed-in user and sign out; shown in the sidebar when there is one. */
  profile: ReactNode;
  children: ReactNode;
}) {
  const link = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} {...(item.end ? { end: true } : {})}>
      {item.label}
    </NavLink>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        {skipLabel}
      </a>
      <header className="topbar">
        <span className="brand">{brand}</span>
        <nav aria-label={topNavLabel} className="topnav">
          {topNav.map(link)}
        </nav>
        {!sideNav && <div className="topbar-user">{profile}</div>}
      </header>
      {sideNav ? (
        <div className="shell">
          <aside className="sidebar">
            <nav aria-label={sideNavLabel}>{sideNav.map(link)}</nav>
            <div className="sidebar-profile">{profile}</div>
          </aside>
          <div className="shell-main">{children}</div>
        </div>
      ) : (
        children
      )}
    </>
  );
}
