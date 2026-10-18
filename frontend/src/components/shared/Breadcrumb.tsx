import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

export interface Crumb {
  label: string;
  /** Left out for the page you are on. */
  to?: string;
}

/** Where you are, and a Back button to the page above. The last crumb is the current page. */
export function Breadcrumb({
  label,
  backLabel,
  crumbs,
}: {
  label: string;
  backLabel: string;
  crumbs: readonly Crumb[];
}) {
  const navigate = useNavigate();
  const parent = [...crumbs].reverse().find((c) => c.to !== undefined);
  // Back goes to the page you came from; opened straight from a link, it goes to the page above.
  const hasHistory = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <div className="breadcrumb-bar">
      {hasHistory ? (
        <button type="button" className="button button-icon-text" onClick={() => void navigate(-1)}>
          <ArrowLeft size={14} aria-hidden="true" />
          {backLabel}
        </button>
      ) : (
        parent?.to && (
          <Link className="button button-icon-text" to={parent.to}>
            <ArrowLeft size={14} aria-hidden="true" />
            {backLabel}
          </Link>
        )
      )}
      <nav aria-label={label}>
        <ol className="breadcrumb">
          {crumbs.map((crumb, i) => (
            <li key={`${i}-${crumb.label}`}>
              {crumb.to !== undefined && i < crumbs.length - 1 ? (
                <Link to={crumb.to}>{crumb.label}</Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
