import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface NavItem {
  to: string;
  label: string;
  /** Match this link only on its exact address. */
  end?: boolean;
  /** Shown beside the label; with the sidebar collapsed it is all that is shown. */
  icon?: ReactNode;
  /** A count (active runs, new leads); nothing is shown for 0 or when left out. */
  badge?: number;
  /** Says what the count means, for screen readers ("2 active runs"). */
  badgeLabel?: string;
}

export interface NavGroup {
  id: string;
  items: readonly NavItem[];
}

const COLLAPSE_KEY = 'leadgen.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The signed-in person: a button with their initial, name and a chevron that opens a menu. */
function ProfileMenu({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="profile" ref={root}>
      <button
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-controls={id}
        title={name}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {(name.trim()[0] ?? '?').toUpperCase()}
        </span>
        <span className="profile-name nav-text">{name}</span>
        <ChevronDown size={14} aria-hidden="true" className="profile-chevron nav-text" />
      </button>
      {open && (
        <div id={id} className="profile-menu">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The frame around every page: a top bar with the brand and main tabs, and an optional sidebar.
 * The sidebar has the profile at its top, links grouped by relevance with an icon and an
 * optional count, Settings and Help at its bottom, and can fold down to icons only. Without a
 * sidebar the profile sits in the top bar instead.
 */
export function AppShell({
  brand,
  skipLabel,
  topNav,
  topNavLabel,
  sideNav,
  sideFooter,
  sideNavLabel,
  collapseLabel,
  expandLabel,
  profileName,
  profile,
  countrySwitch,
  banner,
  children,
}: {
  brand: string;
  skipLabel: string;
  topNav: readonly NavItem[];
  topNavLabel: string;
  sideNav?: readonly NavGroup[];
  /** Links pinned to the bottom of the sidebar (Settings, Help). */
  sideFooter?: readonly NavItem[];
  sideNavLabel?: string;
  collapseLabel?: string;
  expandLabel?: string;
  /** Who is signed in, shown on the profile button. */
  profileName: string;
  /** What the profile menu holds (sign out). */
  profile: ReactNode;
  /** The country switch: at the top of the sidebar, or in the top bar on pages without one. */
  countrySwitch?: ReactNode;
  /** Fixed to the bottom edge of the top bar, above every page (the live run banner). */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // Not remembered; the sidebar still folds.
      }
      return !c;
    });

  const link = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} title={item.label} {...(item.end ? { end: true } : {})}>
      {item.icon}
      <span className="nav-text">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="nav-badge" {...(item.badgeLabel ? { 'aria-label': item.badgeLabel } : {})}>
          {item.badge}
        </span>
      )}
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
        {!sideNav && (
          <div className="topbar-user">
            {countrySwitch}
            <ProfileMenu name={profileName}>{profile}</ProfileMenu>
          </div>
        )}
      </header>
      {banner}
      {sideNav ? (
        <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
          <aside className="sidebar">
            {countrySwitch}
            <div className="sidebar-top">
              <ProfileMenu name={profileName}>{profile}</ProfileMenu>
              <button
                type="button"
                className="icon-button sidebar-toggle"
                aria-expanded={!collapsed}
                aria-label={collapsed ? expandLabel : collapseLabel}
                title={collapsed ? expandLabel : collapseLabel}
                onClick={toggle}
              >
                {collapsed ? (
                  <PanelLeftOpen size={16} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={16} aria-hidden="true" />
                )}
              </button>
            </div>
            <nav aria-label={sideNavLabel}>
              {sideNav.map((group) => (
                <div key={group.id} className="nav-group">
                  {group.items.map(link)}
                </div>
              ))}
            </nav>
            {sideFooter && <div className="sidebar-footer">{sideFooter.map(link)}</div>}
          </aside>
          <div className="shell-main">{children}</div>
        </div>
      ) : (
        children
      )}
    </>
  );
}
