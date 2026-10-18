import type { ReactNode } from 'react';

export interface LogItem {
  id: string;
  content: ReactNode;
}

/**
 * A scrolling list of events, newest first as given. Shows `emptyText` when there are none and,
 * with `newWindowHref`, a link that opens the same feed in a new window.
 */
export function LogList({
  items,
  label,
  emptyText,
  newWindowHref,
  newWindowLabel,
  className = '',
}: {
  items: readonly LogItem[];
  /** Accessible name of the list. */
  label: string;
  emptyText: string;
  newWindowHref?: string;
  newWindowLabel?: string;
  className?: string;
}) {
  return (
    <div className={`log-list ${className}`.trim()}>
      {newWindowHref && (
        <p className="log-list-link">
          <a href={newWindowHref} target="_blank" rel="noopener noreferrer">
            {newWindowLabel}
          </a>
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol className="events" aria-label={label}>
          {items.map((item) => (
            <li key={item.id}>{item.content}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
